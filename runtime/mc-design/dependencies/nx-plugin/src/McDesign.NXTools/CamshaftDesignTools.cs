using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using NXOpen;
using NXOpen.Features;
using NXOpen.GeometricUtilities;
using NXOpen.UF;
using NXSDK;
using static NXOpen.Face;
using static NXSDK.NXContext;

namespace NXTools
{
    public static class CamshaftDesignTools
    {
        // ===== 命名逻辑名（用于 Name 体系 & FeatureName 映射回找）=====
        private const string CAM_PROFILE_POINT_PREFIX = "CAM_PROFILE_PNT";
        private const string CAM_PROFILE_CURVE_LOGICAL = "CAM_PROFILE_CURVE";

        private const string CAM_LOBE_LOGICAL = "CAM_LOBE_01";
        private const string CAM_SHAFT_LOGICAL = "CAM_SHAFT";
        private const string CAM_END_BOSS_LOGICAL = "CAM_END_BOSS";
        private const string CAM_LOBE_ARRAY_LOGICAL = "CAM_LOBE_ARRAY";

        // Bodies（只作为展示/调试用命名，不作为唯一定位依据）
        private const string CAM_LOBE_BODY_PREFIX = "CAM_LOBE_BODY";
        private const string CAM_SHAFT_BODY_PREFIX = "CAM_SHAFT_BODY";
        private const string CAM_BOSS_BODY_PREFIX = "CAM_BOSS_BODY";

        // Datum（凸轮轴建模内部基准）
        private const string CAM_DATUM_AXIS_Z = "CAM_AXIS_Z";
        private const string CAM_DATUM_PNT_O = "CAM_ORIGIN_PNT";

        // 细节特征（仍保持在本文件内，不拆散）
        private const string CAM_DETAIL_SLOT_LOGICAL = "CAM_DETAIL_SLOT";

        private static readonly string DEFAULT_PROFILE_PATH =
            @"C:\SIEMENS\UG\templates\cam_profile_points\默认凸轮型线.dat";


        // ---------------- 参数校验 ----------------

        private static NXSDK.NXResult ValidatePositive(string name, double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v) || v <= 0)
                return NXResult.Fail(name + " 必须为正数");
            return null;
        }

        private static NXSDK.NXResult ValidatePositiveInt(string name, int v)
        {
            if (v <= 0)
                return NXResult.Fail(name + " 必须为正整数");
            return null;
        }

        private static NXSDK.NXResult ValidateCylinderCount(int n)
        {
            var r = ValidatePositiveInt("cylinder_count", n);
            if (r != null) return r;

            // 约束常见缸数，避免非常规值把阵列/相位搞炸
            if (!(n == 3 || n == 4 || n == 5 || n == 6 || n == 8 || n == 10 || n == 12))
                return NXResult.Fail("当前仅支持常见缸数 3/4/5/6/8/10/12（传入=" + n + "）");
            return null;
        }

        private static string Dbl(double v) { return ModelingBaseTools.ToInvariant(v); }

        // =========================
        // Datum：原点点 + Z 轴（复用，不污染）
        // =========================
        private static void EnsureDatumSystem()
        {
            Part part = WorkPart();

            Point origin = ModelingBaseTools.EnsureNamedPoint(part, CAM_DATUM_PNT_O, new Point3d(0, 0, 0));
            if (origin == null) return;

            Axis axisZ = ModelingBaseTools.EnsureNamedAxisZ(part, CAM_DATUM_AXIS_Z, origin, new Vector3d(0, 0, 1));
            // 允许 axisZ 为 null（best-effort）
        }

        private static Point GetOriginPointOrCreate()
        {
            EnsureDatumSystem();

            try
            {
                foreach (Point p in WorkPart().Points)
                {
                    if (p == null) continue;
                    if (string.Equals((p.Name ?? string.Empty).Trim(), CAM_DATUM_PNT_O, StringComparison.OrdinalIgnoreCase))
                        return p;
                }
            }
            catch { }

            try
            {
                Point p = WorkPart().Points.CreatePoint(new Point3d(0, 0, 0));
                try { p.SetName(CAM_DATUM_PNT_O); } catch { }
                return p;
            }
            catch
            {
                return null;
            }
        }

        private static Axis GetAxisZOrCreate()
        {
            EnsureDatumSystem();

            try
            {
                foreach (Axis ax in WorkPart().Axes)
                {
                    if (ax == null) continue;
                    if (string.Equals((ax.Name ?? string.Empty).Trim(), CAM_DATUM_AXIS_Z, StringComparison.OrdinalIgnoreCase))
                        return ax;
                }
            }
            catch { }

            // 兜底创建（不命名也可）
            try
            {
                Direction dirZ = WorkPart().Directions.CreateDirection(
                    new Point3d(0, 0, 0),
                    new Vector3d(0, 0, 1),
                    SmartObject.UpdateOption.WithinModeling
                );
                return WorkPart().Axes.CreateAxis(null, dirZ, SmartObject.UpdateOption.WithinModeling);
            }
            catch
            {
                return null;
            }
        }

        // =========================
        // 显示/隐藏（保留在本文件内，属于凸轮轴建模视觉管理）
        // =========================
        private static void BlankObjects(params DisplayableObject[] objs)
        {
            if (objs == null || objs.Length == 0) return;
            try { Session().DisplayManager.BlankObjects(objs); } catch { }
        }

        private static void ShowObjects(params DisplayableObject[] objs)
        {
            if (objs == null || objs.Length == 0) return;
            try { Session().DisplayManager.ShowObjects(objs, DisplayManager.LayerSetting.ChangeLayerToSelectable); } catch { }
        }

        private static void BlankBodiesByPrefix(string prefix)
        {
            if (string.IsNullOrWhiteSpace(prefix)) return;

            var list = new List<DisplayableObject>();
            foreach (Body b in WorkPart().Bodies)
            {
                if (b == null) continue;
                string n = b.Name ?? string.Empty;
                if (n.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    list.Add(b);
            }

            if (list.Count > 0) BlankObjects(list.ToArray());
        }

        private static Body FindFirstSolidBodyByPrefix(string bodyPrefix)
        {
            if (string.IsNullOrWhiteSpace(bodyPrefix)) return null;

            foreach (Body b in WorkPart().Bodies)
            {
                if (b == null) continue;
                try
                {
                    if (!b.IsSolidBody) continue;
                }
                catch { continue; }

                string n = b.Name ?? string.Empty;
                if (n.StartsWith(bodyPrefix, StringComparison.OrdinalIgnoreCase))
                    return b;
            }
            return null;
        }

        private static void NameBodies(List<Body> bodies, string prefix)
        {
            if (bodies == null) return;

            int idx = 0;
            for (int i = 0; i < bodies.Count; i++)
            {
                if (bodies[i] == null) continue;
                idx++;
                try { bodies[i].SetName(prefix + "_" + idx.ToString("D2")); } catch { }
            }
        }

        private static HashSet<Tag> SnapshotSolidBodyTagSession()
        {
            var set = new HashSet<Tag>();

            foreach (Body b in WorkPart().Bodies)
            {
                if (b == null) continue;
                try
                {
                    if (b.IsSolidBody) set.Add(b.Tag);
                }
                catch { }
            }

            return set;
        }

        private static List<Body> GetNewSolidBodies(HashSet<Tag> before)
        {
            var res = new List<Body>();

            foreach (Body b in WorkPart().Bodies)
            {
                if (b == null) continue;
                try
                {
                    if (!b.IsSolidBody) continue;
                    if (before != null && before.Contains(b.Tag)) continue;
                    res.Add(b);
                }
                catch { }
            }
            return res;
        }

        // =========================
        // 发火顺序（默认）
        // =========================
        private static int[] GetDefaultFiringOrder(int cylinderCount)
        {
            if (cylinderCount == 4) return new[] { 1, 3, 4, 2 };
            if (cylinderCount == 6) return new[] { 1, 5, 3, 6, 2, 4 };
            if (cylinderCount == 3) return new[] { 1, 3, 2 };
            if (cylinderCount == 5) return new[] { 1, 2, 4, 5, 3 };
            if (cylinderCount == 8) return new[] { 1, 5, 4, 2, 6, 3, 7, 8 };
            if (cylinderCount == 10) return new[] { 1, 6, 5, 10, 2, 7, 3, 8, 4, 9 };
            if (cylinderCount == 12) return new[] { 1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10 };

            var a = new int[cylinderCount];
            for (int i = 0; i < cylinderCount; i++) a[i] = i + 1;
            return a;
        }

        private static int IndexOf(int[] arr, int v)
        {
            for (int i = 0; i < arr.Length; i++)
                if (arr[i] == v) return i;
            return -1;
        }

        // =========================
        // Profile Curve：不靠全局 Name 搜索，直接从 Feature entities 取 Curve
        // =========================
        private static Curve GetProfileCurveOrNull()
        {
            Part part = WorkPart();

            Feature fitFeature = ModelingBaseTools.FindFeatureByLogicalName(part, CAM_PROFILE_CURVE_LOGICAL);
            if (fitFeature == null) return null;

            try
            {
                NXObject[] ents = fitFeature.GetEntities();
                if (ents == null) return null;

                for (int i = 0; i < ents.Length; i++)
                {
                    Curve c = ents[i] as Curve;
                    if (c == null) continue;

                    // best-effort：给曲线一个可读 Name（但不依赖它做唯一定位）
                    try { c.SetName(CAM_PROFILE_CURVE_LOGICAL); } catch { }
                    return c;
                }
            }
            catch { }

            return null;
        }

        // =========================
        // Tool 1：导入型线并拟合（拟合后删除导入点）
        // =========================
        public static NXSDK.NXResult ImportOrUpdateCamProfileCurve(string user_id, string profile_file_path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                string filePath = string.IsNullOrWhiteSpace(profile_file_path) ? DEFAULT_PROFILE_PATH : profile_file_path;
                if (!File.Exists(filePath))
                    return NXResult.Fail("型线文件不存在: " + filePath);

                EnsureDatumSystem();

                // 1) 删除旧导入点（只删我们导入命名前缀的点）
                //    注意：这里不扫描 FeatureName 删除，避免误删用户其他点
                var pointsToDelete = new List<NXObject>();
                foreach (Point p in WorkPart().Points)
                {
                    if (p == null) continue;
                    string pn = p.Name ?? string.Empty;
                    if (pn.StartsWith(CAM_PROFILE_POINT_PREFIX, StringComparison.OrdinalIgnoreCase))
                        pointsToDelete.Add(p);
                }
                if (pointsToDelete.Count > 0)
                    ModelingBaseTools.DeleteObjectsByUpdateManager(pointsToDelete.ToArray());

                // 2) 导入点（用 Tag 差集识别新增点）
                var before = new HashSet<Tag>();
                foreach (Point p in WorkPart().Points)
                {
                    if (p != null) before.Add(p.Tag);
                }

                PointsFromFileBuilder pfb = WorkPart().CreatePointsFromFileBuilder();
                try
                {
                    pfb.FileName = filePath;
                    pfb.CoordinateOption = PointsFromFileBuilder.Options.Wcs;
                    pfb.Commit();
                }
                finally
                {
                    try { pfb.Destroy(); } catch { }
                }

                var newPoints = new List<Point>();
                foreach (Point p in WorkPart().Points)
                {
                    if (p == null) continue;
                    if (!before.Contains(p.Tag))
                        newPoints.Add(p);
                }

                if (newPoints.Count < 3)
                    return NXResult.Fail("导入点数量不足，无法拟合曲线（新增点数=" + newPoints.Count + "）");

                // 3) 命名导入点（便于定位删除）
                for (int i = 0; i < newPoints.Count; i++)
                {
                    try { newPoints[i].SetName(CAM_PROFILE_POINT_PREFIX + "_" + (i + 1).ToString("D4")); } catch { }
                }

                // 4) 复用/更新 FitCurve（按逻辑名回找 feature，再取它的 FeatureName 编辑）
                Feature oldFit = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_PROFILE_CURVE_LOGICAL);
                FitCurve oldFitCurve = oldFit as FitCurve;

                FitCurveBuilder fcb = null;
                Feature fitFeature = null;
                bool fitNonAssociative = false;
                try
                {
                    fcb = WorkPart().Features.CreateFitCurveBuilder(oldFitCurve);

                    fitNonAssociative = !fcb.IsAssociative;

                    fcb.Tolerance = 0.01;
                    fcb.TargetSourceType = FitCurveBuilder.TargetSourceTypes.SpecifiedPoints;
                    fcb.Segments = 120;
                    fcb.Degree = 3;
                    fcb.IsClosedBSpline = true;

                    // NX11：Target.Add
                    var tagged = new TaggedObject[newPoints.Count];
                    for (int i = 0; i < newPoints.Count; i++) tagged[i] = newPoints[i];
                    fcb.Target.Clear();
                    fcb.Target.Add(tagged);

                    NXObject committed = fcb.Commit();
                    fitFeature = committed as Feature;
                    if (fitFeature == null) fitFeature = oldFit;
                }
                finally
                {
                    try { if (fcb != null) fcb.Destroy(); } catch { }
                }

                if (fitFeature == null)
                    return NXResult.Fail("拟合曲线失败：未生成有效 Feature");

                // 5) 设置逻辑名 + 记录 FeatureName 映射（核心：Name 体系 -> FeatureName）
                ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), fitFeature, CAM_PROFILE_CURVE_LOGICAL);

                // 6) 从 feature entities 解析曲线并隐藏
                Curve profileCurve = null;
                try
                {
                    NXObject[] ents = fitFeature.GetEntities();
                    if (ents != null)
                    {
                        for (int i = 0; i < ents.Length; i++)
                        {
                            Curve c = ents[i] as Curve;
                            if (c == null) continue;
                            profileCurve = c;
                            try { c.SetName(CAM_PROFILE_CURVE_LOGICAL); } catch { }
                            break;
                        }
                    }
                }
                catch { }

                if (profileCurve == null)
                    return NXResult.Fail("拟合完成，但无法解析型线曲线实体（Curve）");

                // 7) 删除导入点的时机控制：
                //    - 若已成功设置“非关联拟合”（fitNonAssociative=true），则删除点，避免模型污染；
                //    - 否则保留点，避免后续挤出/更新时发生 NX 内核访问违例（点被曲线特征关联引用）。
                bool pointsDeleted = false;
                if (fitNonAssociative)
                {
                    var newPointNxObjects = new NXObject[newPoints.Count];
                    for (int i = 0; i < newPoints.Count; i++) newPointNxObjects[i] = newPoints[i];
                    ModelingBaseTools.DeleteObjectsByUpdateManager(newPointNxObjects);
                    pointsDeleted = true;
                }

                // 8) 隐藏曲线（保留模型干净）
                try { BlankObjects(profileCurve); } catch { }

                string msg = pointsDeleted
                    ? "型线曲线生成/更新成功（拟合点已删除，曲线默认隐藏）"
                    : "型线曲线生成/更新成功（曲线默认隐藏；拟合点已保留：当前NX环境不支持非关联拟合输出，避免后续内核访问违例）";

                return NXResult.Success(new
                {
                    user_id = user_id,
                    profile_file_path = filePath,
                    curve_name = profileCurve.Name ?? string.Empty,
                    points_deleted = pointsDeleted
                }, msg);
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "型线曲线生成失败");
            }
        }

        // =========================
        // Tool 2：单凸轮（基于型线曲线）
        // =========================
        public static NXSDK.NXResult BuildOrUpdateCamLobeFromProfile(string user_id, double lobe_thickness)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                var chk = ValidatePositive("lobe_thickness", lobe_thickness);
                if (chk != null) return chk;

                EnsureDatumSystem();

                Curve profile = GetProfileCurveOrNull();
                if (profile == null)
                    return NXResult.Fail("未找到型线曲线（CAM_PROFILE_CURVE）。请先执行 ImportOrUpdateCamProfileCurve");

                BlankBodiesByPrefix(CAM_LOBE_BODY_PREFIX);

                Feature oldLobe = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_LOBE_LOGICAL);
                HashSet<Tag> before = SnapshotSolidBodyTagSession();

                ExtrudeBuilder eb = null;
                Feature newLobe = null;

                try
                {
                    eb = WorkPart().Features.CreateExtrudeBuilder(oldLobe);

                    Section section = WorkPart().Sections.CreateSection(0.01, 0.01, 0.5);
                    section.SetAllowedEntityTypes(Section.AllowTypes.OnlyCurves);
                    section.AllowSelfIntersection(true);

                    SelectionIntentRule[] rules = new SelectionIntentRule[1];
                    rules[0] = WorkPart().ScRuleFactory.CreateRuleBaseCurveDumb(new IBaseCurve[] { profile });

                    double[] bb = ModelingBaseTools.AskBoundingBox(profile);
                    Point3d helpPoint = new Point3d(
                        (bb[0] + bb[3]) * 0.5,
                        (bb[1] + bb[4]) * 0.5,
                        (bb[2] + bb[5]) * 0.5
                    );

                    section.AddToSection(rules, profile, null, null, helpPoint, Section.Mode.Create, false);
                    eb.Section = section;

                    Direction dirZ = WorkPart().Directions.CreateDirection(
                        new Point3d(0, 0, 0),
                        new Vector3d(0, 0, 1),
                        SmartObject.UpdateOption.WithinModeling
                    );
                    eb.Direction = dirZ;

                    eb.Limits.StartExtend.Value.RightHandSide = "0";
                    eb.Limits.EndExtend.Value.RightHandSide = Dbl(lobe_thickness);

                    eb.BooleanOperation.Type = BooleanOperation.BooleanType.Create;

                    NXObject committed = eb.Commit();
                    newLobe = committed as Feature;
                    if (newLobe == null) newLobe = oldLobe;
                }
                finally
                {
                    try { if (eb != null) eb.Destroy(); } catch { }
                }

                if (newLobe == null)
                    return NXResult.Fail("单凸轮生成/更新失败：未生成 Feature");

                // 逻辑名 + FeatureName 映射记录
                ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), newLobe, CAM_LOBE_LOGICAL);

                var newBodies = GetNewSolidBodies(before);
                if (newBodies.Count > 0) NameBodies(newBodies, CAM_LOBE_BODY_PREFIX);

                Body seedBody = FindFirstSolidBodyByPrefix(CAM_LOBE_BODY_PREFIX);
                if (seedBody != null) ShowObjects(seedBody);

                return NXResult.Success(new
                {
                    user_id = user_id,
                    lobe_thickness = lobe_thickness,
                    seed_feature = CAM_LOBE_LOGICAL,
                    seed_body = seedBody != null ? (seedBody.Name ?? string.Empty) : string.Empty
                }, "单凸轮生成/更新完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamLobeFromProfile 失败");
            }
        }

        // =========================
        // Tool 3：轴体圆柱
        // =========================
        public static NXSDK.NXResult BuildOrUpdateCamshaftShaft(string user_id, double shaft_length, double shaft_diameter)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                var c1 = ValidatePositive("shaft_length", shaft_length);
                if (c1 != null) return c1;
                var c2 = ValidatePositive("shaft_diameter", shaft_diameter);
                if (c2 != null) return c2;

                EnsureDatumSystem();

                BlankBodiesByPrefix(CAM_SHAFT_BODY_PREFIX);

                Feature oldShaft = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_SHAFT_LOGICAL);
                HashSet<Tag> before = SnapshotSolidBodyTagSession();

                CylinderBuilder cb = null;
                Feature shaftFeature = null;

                try
                {
                    cb = WorkPart().Features.CreateCylinderBuilder(oldShaft);

                    cb.Diameter.RightHandSide = Dbl(shaft_diameter);
                    cb.Height.RightHandSide = Dbl(shaft_length);

                    Axis axisZ = GetAxisZOrCreate();
                    if (axisZ != null) cb.Axis.Direction = axisZ.Direction;

                    Point origin = GetOriginPointOrCreate();
                    if (origin != null) cb.Axis.Point = origin;

                    NXObject committed = cb.Commit();
                    shaftFeature = committed as Feature;
                    if (shaftFeature == null) shaftFeature = oldShaft;
                }
                finally
                {
                    try { if (cb != null) cb.Destroy(); } catch { }
                }

                if (shaftFeature == null)
                    return NXResult.Fail("轴体生成/更新失败：未生成 Feature");

                ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), shaftFeature, CAM_SHAFT_LOGICAL);

                var newBodies = GetNewSolidBodies(before);
                if (newBodies.Count > 0) NameBodies(newBodies, CAM_SHAFT_BODY_PREFIX);

                Body shaftBody = FindFirstSolidBodyByPrefix(CAM_SHAFT_BODY_PREFIX);
                if (shaftBody != null) ShowObjects(shaftBody);

                return NXResult.Success(new
                {
                    user_id = user_id,
                    shaft_length = shaft_length,
                    shaft_diameter = shaft_diameter,
                    shaft_body = shaftBody != null ? (shaftBody.Name ?? string.Empty) : string.Empty
                }, "轴体生成/更新完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamshaftShaft 失败");
            }
        }

        // =========================
        // 细节：挖槽（Subtract：SetTargetBodies）
        // =========================
        private static Feature TryCutKeySlotOnBoss(Body bossBody, double bossDiameter, double bossLength)
        {
            if (bossBody == null) return null;
            if (bossDiameter <= 0 || bossLength <= 0) return null;

            double slotDepth = Math.Max(2.0, bossDiameter * 0.06);
            double slotWidth = Math.Max(6.0, bossDiameter * 0.10);

            double slotZCenter = bossLength * 0.55;
            double slotYHalf = bossDiameter;

            double radius = bossDiameter * 0.5;
            double xOuter = radius + 1.0;
            double xInner = Math.Max(0.5, radius - slotDepth);
            double z1 = slotZCenter - slotWidth * 0.5;
            double z2 = slotZCenter + slotWidth * 0.5;

            ExtrudeBuilder extrudeBuilder = null;
            Line l1 = null, l2 = null, l3 = null, l4 = null;

            try
            {
                extrudeBuilder = WorkPart().Features.CreateExtrudeBuilder(null);

                extrudeBuilder.BooleanOperation.Type = BooleanOperation.BooleanType.Subtract;
                extrudeBuilder.BooleanOperation.SetTargetBodies(new Body[] { bossBody });

                Direction dirY = WorkPart().Directions.CreateDirection(
                    new Point3d(0, 0, 0),
                    new Vector3d(0, 1, 0),
                    SmartObject.UpdateOption.WithinModeling
                );
                extrudeBuilder.Direction = dirY;

                extrudeBuilder.Limits.StartExtend.Value.RightHandSide = Dbl(-slotYHalf);
                extrudeBuilder.Limits.EndExtend.Value.RightHandSide = Dbl(slotYHalf);

                Section section = WorkPart().Sections.CreateSection(0.01, 0.01, 0.5);
                section.SetAllowedEntityTypes(Section.AllowTypes.OnlyCurves);
                extrudeBuilder.Section = section;

                Point3d p1 = new Point3d(xInner, 0, z1);
                Point3d p2 = new Point3d(xOuter, 0, z1);
                Point3d p3 = new Point3d(xOuter, 0, z2);
                Point3d p4 = new Point3d(xInner, 0, z2);

                l1 = WorkPart().Curves.CreateLine(p1, p2);
                l2 = WorkPart().Curves.CreateLine(p2, p3);
                l3 = WorkPart().Curves.CreateLine(p3, p4);
                l4 = WorkPart().Curves.CreateLine(p4, p1);

                var rules = new List<SelectionIntentRule>();
                rules.Add(WorkPart().ScRuleFactory.CreateRuleCurveDumb(new Curve[] { l1 }));
                rules.Add(WorkPart().ScRuleFactory.CreateRuleCurveDumb(new Curve[] { l2 }));
                rules.Add(WorkPart().ScRuleFactory.CreateRuleCurveDumb(new Curve[] { l3 }));
                rules.Add(WorkPart().ScRuleFactory.CreateRuleCurveDumb(new Curve[] { l4 }));

                section.AddToSection(rules.ToArray(), l1, null, null, p1, Section.Mode.Create, false);
                section.AddToSection(rules.ToArray(), l2, null, null, p2, Section.Mode.Create, false);
                section.AddToSection(rules.ToArray(), l3, null, null, p3, Section.Mode.Create, false);
                section.AddToSection(rules.ToArray(), l4, null, null, p4, Section.Mode.Create, false);

                Feature f = extrudeBuilder.CommitFeature();
                if (f != null)
                {
                    ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), f, CAM_DETAIL_SLOT_LOGICAL);
                }

                // 线条隐藏即可（不删，避免 NX 依赖）
                BlankObjects(l1, l2, l3, l4);
                return f;
            }
            catch
            {
                try { BlankObjects(l1, l2, l3, l4); } catch { }
                return null;
            }
            finally
            {
                try { if (extrudeBuilder != null) extrudeBuilder.Destroy(); } catch { }
            }
        }

        // =========================
        // Tool 4：端部凸台
        // =========================
        public static NXSDK.NXResult BuildOrUpdateEndBoss(string user_id, double boss_length, double boss_diameter)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                var c1 = ValidatePositive("boss_length", boss_length);
                if (c1 != null) return c1;
                var c2 = ValidatePositive("boss_diameter", boss_diameter);
                if (c2 != null) return c2;

                EnsureDatumSystem();

                BlankBodiesByPrefix(CAM_BOSS_BODY_PREFIX);

                Feature oldBoss = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_END_BOSS_LOGICAL);
                HashSet<Tag> before = SnapshotSolidBodyTagSession();

                CylinderBuilder cb = null;
                Feature bossFeature = null;

                try
                {
                    cb = WorkPart().Features.CreateCylinderBuilder(oldBoss);

                    cb.Diameter.RightHandSide = Dbl(boss_diameter);
                    cb.Height.RightHandSide = Dbl(boss_length);

                    Axis axisZ = GetAxisZOrCreate();
                    if (axisZ != null) cb.Axis.Direction = axisZ.Direction;

                    Point origin = GetOriginPointOrCreate();
                    if (origin != null) cb.Axis.Point = origin;

                    NXObject committed = cb.Commit();
                    bossFeature = committed as Feature;
                    if (bossFeature == null) bossFeature = oldBoss;
                }
                finally
                {
                    try { if (cb != null) cb.Destroy(); } catch { }
                }

                if (bossFeature == null)
                    return NXResult.Fail("端部凸台生成/更新失败：未生成 Feature");

                ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), bossFeature, CAM_END_BOSS_LOGICAL);

                var newBodies = GetNewSolidBodies(before);
                if (newBodies.Count > 0) NameBodies(newBodies, CAM_BOSS_BODY_PREFIX);

                Body bossBody = FindFirstSolidBodyByPrefix(CAM_BOSS_BODY_PREFIX);
                if (bossBody != null) ShowObjects(bossBody);

                Feature slotF = TryCutKeySlotOnBoss(bossBody, boss_diameter, boss_length);

                return NXResult.Success(new
                {
                    user_id = user_id,
                    boss_length = boss_length,
                    boss_diameter = boss_diameter,
                    boss_body = bossBody != null ? (bossBody.Name ?? string.Empty) : string.Empty,
                    slot_created = (slotF != null)
                }, "端部凸台生成/更新完成（含挖槽）");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateEndBoss 失败");
            }
        }

        // =========================
        // 阵列实例：取实例 Z 中心（用于排序）
        // =========================
        private static double GetInstanceZCenter(InstanceFeature inst)
        {
            try
            {
                var bodies = ModelingBaseTools.GetSolidBodiesFromFeature(inst);
                if (bodies != null && bodies.Count > 0 && bodies[0] != null)
                {
                    double[] box = ModelingBaseTools.AskBoundingBox(bodies[0]);
                    return 0.5 * (box[2] + box[5]);
                }
            }
            catch { }
            return 0.0;
        }

        // =========================
        // 对实例设置 Clocking 角度（创建临时 axis/point，用 UpdateManager 删除）
        // =========================
        private static bool ApplyInstanceClockingAngle(InstanceFeature inst, double angleDeg)
        {
            if (inst == null) return false;

            InstanceFeatureBuilder builder = null;
            Point axisPoint = null;
            Axis axis = null;

            try
            {
                builder = WorkPart().Features.CreateInstanceFeatureBuilder(new InstanceFeature[] { inst }, true);

                builder.InstanceClocking.ClockType = PatternClockingBuilder.ClockingType.UserDefined;
                builder.InstanceClocking.Motion.Option = ModlMotion.Options.Angle;

                Axis baseAxis = GetAxisZOrCreate();
                if (baseAxis == null) return false;

                double zc = GetInstanceZCenter(inst);
                axisPoint = WorkPart().Points.CreatePoint(new Point3d(0, 0, zc));
                axis = WorkPart().Axes.CreateAxis(axisPoint, baseAxis.Direction, SmartObject.UpdateOption.WithinModeling);

                builder.InstanceClocking.Motion.AngularAxis = axis;
                builder.InstanceClocking.Motion.Angle.RightHandSide = Dbl(angleDeg);

                builder.Commit();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                try { if (builder != null) builder.Destroy(); } catch { }

                // 关键：清理临时对象，避免污染
                try { if (axis != null) ModelingBaseTools.DeleteObjectsByUpdateManager(axis); } catch { }
                try { if (axisPoint != null) ModelingBaseTools.DeleteObjectsByUpdateManager(axisPoint); } catch { }
            }
        }

        // =========================
        // Tool 5：阵列 + 相位（补全实现，解决“阵列不出来”）
        // =========================
        public static NXSDK.NXResult BuildOrUpdateCamLobeArray(string user_id, int cylinder_count, double cylinder_pitch)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                var chk0 = ValidateCylinderCount(cylinder_count);
                if (chk0 != null) return chk0;

                var chk1 = ValidatePositive("cylinder_pitch", cylinder_pitch);
                if (chk1 != null) return chk1;

                EnsureDatumSystem();

                // 1) 必须先有单凸轮 seed
                Feature seedLobe = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_LOBE_LOGICAL);
                if (seedLobe == null)
                    return NXResult.Fail("未找到单凸轮（CAM_LOBE_01）。请先执行 BuildOrUpdateCamLobeFromProfile");

                // 2) 记录阵列前的 InstanceFeature（用 Tag 差集抓新增实例）
                var instBefore = new HashSet<Tag>();
                foreach (Feature f in WorkPart().Features)
                {
                    InstanceFeature inst = f as InstanceFeature;
                    if (inst != null) instBefore.Add(inst.Tag);
                }

                // 3) 创建或编辑 PatternFeature（逻辑名回找）
                Feature existArray = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_LOBE_ARRAY_LOGICAL);
                PatternFeature existPattern = existArray as PatternFeature;

                PatternFeatureBuilder patternBuilder = null;
                PatternFeature patternFeature = null;

                try
                {
                    patternBuilder = WorkPart().Features.CreatePatternFeatureBuilder(existPattern);

                    patternBuilder.PatternMethod = PatternFeatureBuilder.PatternMethodOptions.Variational;
                    patternBuilder.PatternService.PatternType = PatternDefinition.PatternEnum.Linear;

                    // seed
                    patternBuilder.FeatureList.Clear();
                    patternBuilder.FeatureList.Add(new Feature[] { seedLobe });

                    // XDirection = Z
                    Direction dirZ = WorkPart().Directions.CreateDirection(
                        new Point3d(0, 0, 0),
                        new Vector3d(0, 0, 1),
                        SmartObject.UpdateOption.WithinModeling
                    );
                    patternBuilder.PatternService.RectangularDefinition.XDirection = dirZ;

                    // copies / pitch
                    patternBuilder.PatternService.RectangularDefinition.XSpacing.NCopies.RightHandSide =
                        cylinder_count.ToString(CultureInfo.InvariantCulture);

                    patternBuilder.PatternService.RectangularDefinition.XSpacing.PitchDistance.RightHandSide =
                        Dbl(cylinder_pitch);

                    // Y 固定 1
                    patternBuilder.PatternService.RectangularDefinition.YSpacing.NCopies.RightHandSide = "1";

                    // Reference Point：用原点点（避免创建临时点导致污染/断关联）
                    Point origin = GetOriginPointOrCreate();
                    if (origin != null)
                        patternBuilder.ReferencePointService.Point = origin;

                    NXObject committed = patternBuilder.Commit();
                    patternFeature = committed as PatternFeature;
                }
                finally
                {
                    try { if (patternBuilder != null) patternBuilder.Destroy(); } catch { }
                }

                if (patternFeature == null)
                    return NXResult.Fail("凸轮阵列失败：未生成 PatternFeature（请检查单凸轮是否为有效实体）");

                // 记录逻辑名 + FeatureName 映射
                ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), patternFeature, CAM_LOBE_ARRAY_LOGICAL);

                // 4) 收集新增实例
                var newInstances = new List<InstanceFeature>();
                foreach (Feature f in WorkPart().Features)
                {
                    InstanceFeature inst = f as InstanceFeature;
                    if (inst == null) continue;
                    if (instBefore.Contains(inst.Tag)) continue;
                    newInstances.Add(inst);
                }

                // 兜底：若 NX 复用实例 Tag（少见），则按类型全量取（再做 bbox 排序）
                if (newInstances.Count == 0)
                {
                    foreach (Feature f in WorkPart().Features)
                    {
                        InstanceFeature inst = f as InstanceFeature;
                        if (inst != null) newInstances.Add(inst);
                    }
                }

                if (newInstances.Count == 0)
                    return NXResult.Fail("阵列已生成，但未找到 InstanceFeature 实例。请检查：单凸轮是否实际生成了实体。");

                // 5) 按 Z 位置排序，认为 i=0.. 对应 cylinder 1..N
                newInstances.Sort((a, b) => GetInstanceZCenter(a).CompareTo(GetInstanceZCenter(b)));

                // 6) 相位：按发火顺序设置角度
                int[] firing = GetDefaultFiringOrder(cylinder_count);
                double step = 360.0 / cylinder_count;

                int rotated = 0;
                int count = Math.Min(cylinder_count, newInstances.Count);

                for (int i = 0; i < count; i++)
                {
                    int cylinderNo = i + 1;
                    int firingIdx = IndexOf(firing, cylinderNo);
                    if (firingIdx < 0) firingIdx = i;

                    double angle = firingIdx * step;

                    if (ApplyInstanceClockingAngle(newInstances[i], angle))
                        rotated++;
                }

                return NXResult.Success(new
                {
                    user_id = user_id,
                    cylinder_count = cylinder_count,
                    cylinder_pitch = cylinder_pitch,
                    firing_order = string.Join("-", firing),
                    found_instances = newInstances.Count,
                    rotated_instances = rotated
                }, "凸轮阵列生成/更新完成（含相位旋转）");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamLobeArray 失败");
            }
        }

        // =========================
        // Tool 6：一键（协议不变）
        // =========================

        // =========================
        // 过渡区 / 安装面 / 细节收口（新增原子工具）
        // 说明：
        // - 不改动你已有 Tool 的协议与主体逻辑；
        // - 以下工具全部“效果导向”，直接在当前 WorkPart 上产生可见几何；
        // - 基于 NX11 + C# 7.3：不使用静态本地函数 / 反射拼 API / C#8+ 语法。
        // =========================

        private const string CAM_UNITE_LOGICAL = "CAM_UNITE";
        private const string CAM_TRANSITION_BLEND_LOGICAL = "CAM_TRANSITION_BLEND";
        private const string CAM_MOUNT_SEAT_LOGICAL_PREFIX = "CAM_MOUNT_SEAT_";
        private const string CAM_DETAIL_BLEND_LOGICAL = "CAM_DETAIL_BLEND";

        /// <summary>
        /// 按前缀找当前零件中第一个实体 Body（含被布尔“吸收”的 Body 在某些场景仍可枚举到）。
        /// </summary>
        private static Body FindFirstSolidBodyByPrefixInPart(string prefix)
        {
            prefix = (prefix ?? string.Empty).Trim();
            if (prefix.Length == 0) return null;

            try
            {
                foreach (Body b in WorkPart().Bodies)
                {
                    if (b == null) continue;
                    if (!b.IsSolidBody) continue;

                    string n = (b.Name ?? string.Empty).Trim();
                    if (n.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        return b;
                }
            }
            catch { }

            return null;
        }

        /// <summary>
        /// 按前缀收集实体 Bodies。
        /// </summary>
        private static List<Body> CollectSolidBodiesByPrefix(string prefix)
        {
            var list = new List<Body>();
            prefix = (prefix ?? string.Empty).Trim();
            if (prefix.Length == 0) return list;

            try
            {
                foreach (Body b in WorkPart().Bodies)
                {
                    if (b == null) continue;
                    if (!b.IsSolidBody) continue;

                    string n = (b.Name ?? string.Empty).Trim();
                    if (n.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        list.Add(b);
                }
            }
            catch { }

            return list;
        }

        /// <summary>
        /// 将轴体/凸台/凸轮阵列合并为一个实体（目标：CAM_SHAFT_BODY*；工具体：CAM_BOSS_BODY* + CAM_LOBE_BODY*）。
        /// 返回合体后的“当前实体”Body（优先从布尔特征实体里取，否则回退到按前缀找）。
        /// </summary>
        private static Body EnsureCamshaftUnifiedBody()
        {
            Part part = WorkPart();

            // 目标体：优先取 shaft body
            Body target = FindFirstSolidBodyByPrefixInPart(CAM_SHAFT_BODY_PREFIX);
            if (target == null)
            {
                // 兜底：任意第一个实体
                try
                {
                    foreach (Body b in part.Bodies)
                    {
                        if (b != null && b.IsSolidBody) { target = b; break; }
                    }
                }
                catch { }
            }
            if (target == null) return null;

            // 工具体：凸台 + 凸轮
            var tools = new List<Body>();
            tools.AddRange(CollectSolidBodiesByPrefix(CAM_BOSS_BODY_PREFIX));
            tools.AddRange(CollectSolidBodiesByPrefix(CAM_LOBE_BODY_PREFIX));

            // 去掉 target 自己
            tools.RemoveAll(b => b == null || b.Tag == target.Tag);

            if (tools.Count == 0)
                return target;

            Feature old = ModelingBaseTools.FindFeatureByLogicalName(part, CAM_UNITE_LOGICAL);

            Feature unite = ModelingBaseTools.BooleanUniteBodies(part, old, target, tools);
            if (unite != null)
            {
                ModelingBaseTools.SetLogicalNameAndRemember(part, unite, CAM_UNITE_LOGICAL);

                // 尝试取布尔结果的实体
                Body res = ModelingBaseTools.TryGetFirstSolidBodyFromFeature(unite);
                if (res != null) return res;
            }

            // 回退：仍返回 target
            return target;
        }

        /// <summary>
        /// 计算所有凸轮实体（CAM_LOBE_BODY*）的 Z 中心集合（去重、排序）。
        /// </summary>
        private static List<double> GetLobeCentersZ()
        {
            var centers = new List<double>();
            var lobes = CollectSolidBodiesByPrefix(CAM_LOBE_BODY_PREFIX);
            for (int i = 0; i < lobes.Count; i++)
            {
                var bb = ModelingBaseTools.AskBoundingBox(lobes[i]);
                double cz = (bb[2] + bb[5]) * 0.5;
                centers.Add(cz);
            }

            // 去重（容差）
            centers.Sort();
            var uniq = new List<double>();
            const double tol = 1e-4;
            for (int i = 0; i < centers.Count; i++)
            {
                if (uniq.Count == 0 || Math.Abs(centers[i] - uniq[uniq.Count - 1]) > tol)
                    uniq.Add(centers[i]);
            }
            return uniq;
        }

        /// <summary>
        /// 获取“合体实体”上可用于倒圆的候选边：相邻面包含(圆柱面 & 平面) 或 (两平面) 的边。
        /// 这是过渡区/端面倒圆最稳的自动选择策略。
        /// </summary>
        private static List<Edge> CollectBlendCandidateEdges(Body solid)
        {
            var edges = new List<Edge>();
            if (solid == null) return edges;

            try
            {
                Edge[] all = solid.GetEdges();
                if (all == null) return edges;

                for (int i = 0; i < all.Length; i++)
                {
                    Edge e = all[i];
                    if (e == null) continue;

                    Face[] fs = null;
                    try { fs = e.GetFaces(); } catch { fs = null; }
                    if (fs == null || fs.Length < 2) continue;

                    // 只看前两个面（通常为2面边）
                    FaceType t0 = FaceType.Planar;
                    FaceType t1 = FaceType.Planar;
                    try { t0 = fs[0].SolidFaceType; } catch { }
                    try { t1 = fs[1].SolidFaceType; } catch { }

                    bool cylPlan =
                        (t0 == FaceType.Cylindrical && t1 == FaceType.Planar) ||
                        (t1 == FaceType.Cylindrical && t0 == FaceType.Planar);

                    bool planPlan = (t0 == FaceType.Planar && t1 == FaceType.Planar);

                    if (cylPlan || planPlan)
                        edges.Add(e);
                }
            }
            catch { }

            return edges;
        }

        /// <summary>
        /// 在指定实体上倒圆（Edge Blend）。若失败，不抛异常，返回 null。
        /// </summary>
        private static Feature TryEdgeBlendByEdges(Body solid, List<Edge> edges, double radius)
        {
            if (solid == null) return null;
            if (edges == null || edges.Count == 0) return null;
            if (radius <= 0) return null;

            Part part = WorkPart();
            EdgeBlendBuilder b = null;
            ScCollector sc = null;

            try
            {
                b = part.Features.CreateEdgeBlendBuilder(null);
                b.Tolerance = 0.01;

                // 创建 collector + 规则
                sc = part.ScCollectors.CreateCollector();
                var rules = new List<SelectionIntentRule>();

                for (int i = 0; i < edges.Count; i++)
                {
                    Edge e = edges[i];
                    if (e == null) continue;
                    try
                    {
                        // Journal 用的是 CreateRuleEdgeChain
                        var r = part.ScRuleFactory.CreateRuleEdgeChain(e, null, false, null, false);
                        if (r != null) rules.Add(r);
                    }
                    catch { }
                }

                if (rules.Count == 0) return null;

                sc.ReplaceRules(rules.ToArray(), false);

                // 半径用字符串：与 Journal 完全一致的入口
                b.AddChainset(sc, Dbl(radius));

                Feature f = b.CommitFeature();
                return f;
            }
            catch
            {
                return null;
            }
            finally
            {
                try { if (b != null) b.Destroy(); } catch { }
                try { if (sc != null) sc.Destroy(); } catch { }
            }
        }

        /// <summary>
        /// Tool：过渡区建模（合体 + 过渡倒圆）
        /// </summary>
        public static NXSDK.NXResult BuildOrUpdateCamshaftTransitionZone(
            string user_id,
            double transition_fillet_radius = 3.0
        )
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                if (transition_fillet_radius <= 0)
                    return NXResult.Fail("transition_fillet_radius 必须为正数");

                Body unified = EnsureCamshaftUnifiedBody();
                if (unified == null)
                    return NXResult.Fail("过渡区建模失败：未找到可合并的实体（请先生成轴体/凸台/凸轮阵列）");

                // 自动抓取“过渡边”做倒圆
                var edges = CollectBlendCandidateEdges(unified);
                Feature oldBlend = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_TRANSITION_BLEND_LOGICAL);

                // 旧倒圆存在则删（不修改其它特征）
                if (oldBlend != null)
                {
                    try { ModelingBaseTools.DeleteObjectsByUpdateManager(oldBlend); } catch { }
                }

                Feature blend = TryEdgeBlendByEdges(unified, edges, transition_fillet_radius);
                if (blend != null)
                {
                    ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), blend, CAM_TRANSITION_BLEND_LOGICAL);
                }

                return NXResult.Success(new
                {
                    user_id = user_id,
                    unified = true,
                    transition_fillet_radius = transition_fillet_radius,
                    blended = (blend != null)
                }, "过渡区建模完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamshaftTransitionZone 失败");
            }
        }

        /// <summary>
        /// Tool：安装面建模（按凸轮中心 Z 阵列下沉台阶/平面）
        /// 说明：默认使用凸轮实体中心 Z 来定位，避免依赖“轴自动 _01”等不稳定命名。
        /// </summary>
        public static NXSDK.NXResult BuildOrUpdateCamshaftMountFace(
            string user_id,
            double shaft_diameter = 60.0,
            double seat_depth = 2.0,
            double seat_flat_width = 20.0,
            double seat_z_width = 20.0
        )
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                if (shaft_diameter <= 0) return NXResult.Fail("shaft_diameter 必须为正数");
                if (seat_depth <= 0) return NXResult.Fail("seat_depth 必须为正数");
                if (seat_flat_width <= 0) return NXResult.Fail("seat_flat_width 必须为正数");
                if (seat_z_width <= 0) return NXResult.Fail("seat_z_width 必须为正数");

                Body unified = EnsureCamshaftUnifiedBody();
                if (unified == null)
                    return NXResult.Fail("安装面建模失败：未找到可合并的实体（请先生成轴体/凸台/凸轮阵列）");

                // 由凸轮实体中心确定阵列位置
                var centers = GetLobeCentersZ();
                if (centers.Count == 0)
                    return NXResult.Fail("安装面建模失败：未找到凸轮实体（CAM_LOBE_BODY*），无法计算凸轮中心位置");

                double r = shaft_diameter * 0.5;

                // 对每个凸轮中心做一个“平面/台阶”切除（沿 Z 方向限定宽度）
                // 实现：在 XY 平面创建矩形截面，沿 Z 方向做 Subtract Extrude。
                // 截面矩形设置为：X 方向为 seat_flat_width，Y 方向从 (r - seat_depth) 到 (r + 2*seat_depth)
                // 这样会在 +Y 方向切出一条平面（工业“安装平面/座面”常见表现），且不会生成额外拉伸轴体。
                var createdFeatures = new List<string>();

                for (int i = 0; i < centers.Count; i++)
                {
                    double cz = centers[i];
                    string logical = CAM_MOUNT_SEAT_LOGICAL_PREFIX + (i + 1).ToString(CultureInfo.InvariantCulture);

                    // 删除旧特征（同名逻辑）
                    Feature old = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), logical);
                    if (old != null)
                    {
                        try { ModelingBaseTools.DeleteObjectsByUpdateManager(old); } catch { }
                    }

                    // 2D 曲线（矩形）
                    Line l1 = null, l2 = null, l3 = null, l4 = null;
                    ExtrudeBuilder eb = null;
                    Section section = null;

                    try
                    {
                        double hx = seat_flat_width * 0.5;
                        double y0 = r - seat_depth;
                        double y1 = r + seat_depth * 2.0;

                        Point3d p1 = new Point3d(-hx, y0, 0);
                        Point3d p2 = new Point3d(hx, y0, 0);
                        Point3d p3 = new Point3d(hx, y1, 0);
                        Point3d p4 = new Point3d(-hx, y1, 0);

                        l1 = WorkPart().Curves.CreateLine(p1, p2);
                        l2 = WorkPart().Curves.CreateLine(p2, p3);
                        l3 = WorkPart().Curves.CreateLine(p3, p4);
                        l4 = WorkPart().Curves.CreateLine(p4, p1);

                        section = WorkPart().Sections.CreateSection(0.01, 0.01, 0.5);
                        section.SetAllowedEntityTypes(Section.AllowTypes.OnlyCurves);

                        var rules = new SelectionIntentRule[]
                        {
                            WorkPart().ScRuleFactory.CreateRuleCurveDumb(new Curve[] { l1, l2, l3, l4 })
                        };

                        section.AddToSection(rules, l1, null, null, new Point3d(0, y0, 0), Section.Mode.Create, false);

                        // Extrude（Subtract）
                        eb = WorkPart().Features.CreateExtrudeBuilder(null);
                        eb.Section = section;

                        Direction dirZ = WorkPart().Directions.CreateDirection(
                            new Point3d(0, 0, 0),
                            new Vector3d(0, 0, 1),
                            SmartObject.UpdateOption.WithinModeling
                        );
                        eb.Direction = dirZ;

                        // 以凸轮中心为中点限定 Z 范围
                        double z0 = cz - seat_z_width * 0.5;
                        double z1 = cz + seat_z_width * 0.5;

                        eb.Limits.StartExtend.Value.RightHandSide = Dbl(z0);
                        eb.Limits.EndExtend.Value.RightHandSide = Dbl(z1);

                        eb.BooleanOperation.Type = BooleanOperation.BooleanType.Subtract;

                        // 指定目标体：合体实体
                        try
                        {
                            eb.BooleanOperation.SetTargetBodies(new Body[] { unified });
                        }
                        catch
                        {
                            // NX 版本差异下 best-effort
                        }

                        Feature f = eb.CommitFeature();
                        if (f != null)
                        {
                            ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), f, logical);
                            createdFeatures.Add(logical);
                        }
                    }
                    finally
                    {
                        try { if (eb != null) eb.Destroy(); } catch { }
                        try
                        {
                            // 曲线隐藏即可，避免删导致 NX 依赖异常
                            BlankObjects(l1, l2, l3, l4);
                        }
                        catch { }
                    }
                }

                return NXResult.Success(new
                {
                    user_id = user_id,
                    mount_face_count = createdFeatures.Count,
                    mount_face_features = createdFeatures
                }, "安装面建模完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamshaftMountFace 失败");
            }
        }

        /// <summary>
        /// Tool：细节收口（再次合体兜底 + 统一倒圆）
        /// </summary>
        public static NXSDK.NXResult BuildOrUpdateCamshaftDetailFinish(
            string user_id,
            double detail_fillet_radius = 2.0
        )
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                if (detail_fillet_radius <= 0)
                    return NXResult.Fail("detail_fillet_radius 必须为正数");

                Body unified = EnsureCamshaftUnifiedBody();
                if (unified == null)
                    return NXResult.Fail("细节收口失败：未找到可合并的实体（请先生成轴体/凸台/凸轮阵列）");

                // 候选边（同过渡区策略，但半径更小）
                var edges = CollectBlendCandidateEdges(unified);

                Feature old = ModelingBaseTools.FindFeatureByLogicalName(WorkPart(), CAM_DETAIL_BLEND_LOGICAL);
                if (old != null)
                {
                    try { ModelingBaseTools.DeleteObjectsByUpdateManager(old); } catch { }
                }

                Feature blend = TryEdgeBlendByEdges(unified, edges, detail_fillet_radius);
                if (blend != null)
                {
                    ModelingBaseTools.SetLogicalNameAndRemember(WorkPart(), blend, CAM_DETAIL_BLEND_LOGICAL);
                }

                return NXResult.Success(new
                {
                    user_id = user_id,
                    unified = true,
                    detail_fillet_radius = detail_fillet_radius,
                    blended = (blend != null)
                }, "细节收口完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildOrUpdateCamshaftDetailFinish 失败");
            }
        }


        public static NXSDK.NXResult BuildCamshaftOneClick(
                    string user_id,
                    string profile_file_path,
                    int cylinder_count,
                    double cylinder_pitch,
                    double lobe_thickness,
                    double shaft_diameter,
                    double shaft_length,
                    double boss_diameter,
                    double boss_length
                )
        {
            try
            {
                if (string.IsNullOrWhiteSpace(user_id))
                    return NXResult.Fail("user_id 不能为空");

                var chk0 = ValidateCylinderCount(cylinder_count);
                if (chk0 != null) return chk0;

                var r1 = ImportOrUpdateCamProfileCurve(user_id, profile_file_path);
                if (!r1.Ok) return r1;

                var r2 = BuildOrUpdateCamLobeFromProfile(user_id, lobe_thickness);
                if (!r2.Ok) return r2;

                var r3 = BuildOrUpdateCamshaftShaft(user_id, shaft_length, shaft_diameter);
                if (!r3.Ok) return r3;

                var r4 = BuildOrUpdateEndBoss(user_id, boss_length, boss_diameter);
                if (!r4.Ok) return r4;

                var r5 = BuildOrUpdateCamLobeArray(user_id, cylinder_count, cylinder_pitch);
                if (!r5.Ok) return r5;


                // === 新增效果型原子工具（默认值）===
                // 1) 过渡区：合体 + 过渡倒圆
                var rz1 = BuildOrUpdateCamshaftTransitionZone(user_id, 3.0);
                if (!rz1.Ok) return rz1;

                // 2) 安装面：按凸轮中心阵列下沉台阶（默认：浅切 2mm，Z宽度=凸轮厚度）
                var rz2 = BuildOrUpdateCamshaftMountFace(user_id, shaft_diameter, 2.0, 20.0, lobe_thickness);
                if (!rz2.Ok) return rz2;

                // 3) 细节收口：统一倒圆（更小半径）
                var rz3 = BuildOrUpdateCamshaftDetailFinish(user_id, 2.0);
                if (!rz3.Ok) return rz3;

                return NXResult.Success(new
                {
                    user_id = user_id,
                    built = true
                }, "一键建模完成（更新式）");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildCamshaftOneClick 失败");
            }
        }
    }
}
