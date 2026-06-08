using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using NXOpen;
using NXOpen.Features;
using NXOpen.GeometricUtilities;
using NXOpen.UF;
using NXSDK;
using static NXSDK.NXContext;
using static NXTools.ModelingTools;
using static NXTools.ExpressionTools;

namespace NXTools
{
    public static class CamshaftTools
    {
        private const string DEFAULT_PROFILE_PATH =
            @"C:\SIEMENS\UG\templates\cam_profile_points\默认凸轮型线.dat";

        private const string CAM_PROFILE_POINT_PREFIX = "CAM_PROFILE_POINT_";
        private const string CAM_PROFILE_CURVE = "CAM_PROFILE_CURVE";

        private const string CAM_LOBE_BODY_PREFIX = "CAM_LOBE_BODY_";
        private const string CAM_LOBE_ARRAY = "CAM_LOBE_ARRAY";

        private const string CAM_SHAFT_BODY = "CAM_SHAFT_BODY";
        private const string CAM_END_BOSS = "CAM_END_BOSS";

        private static bool IsCreate(Feature oldFeature) => oldFeature == null;

        public static NXResult ImportCamProfile(string profile_file_path = DEFAULT_PROFILE_PATH)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(profile_file_path))
                    profile_file_path = DEFAULT_PROFILE_PATH;

                if (!File.Exists(profile_file_path))
                    return NXResult.Fail("型线文件不存在: " + profile_file_path);

                DeleteNXObjectByPrefix(WorkPart().Points.ToArray(), CAM_PROFILE_POINT_PREFIX);

                PointsFromFileBuilder pfb = WorkPart().CreatePointsFromFileBuilder();
                List<Point> newPoints = new List<Point>();

                Group point_group = null;
                Tag[] point_tags;
                int count;

                try
                {
                    pfb.FileName = profile_file_path;
                    pfb.CoordinateOption = PointsFromFileBuilder.Options.Wcs;
                    pfb.Commit();

                    point_group = pfb.GetObject() as NXOpen.Group;
                    if (point_group == null)
                        return NXResult.Fail("型线导入失败：未获得点组对象（Group）。");

                    UF().Group.AskGroupData(point_group.Tag, out point_tags, out count);
                    if (count < 3)
                        return NXResult.Fail("导入点数量不足，无法拟合曲线（新增点数=" + count + "）");

                    for (int i = 0; i < count; i++)
                    {
                        var p = NXOpen.Utilities.NXObjectManager.Get(point_tags[i]) as Point;
                        if (p != null) newPoints.Add(p);
                    }

                    if (newPoints.Count < 3)
                        return NXResult.Fail("导入点数量不足（有效点<3），无法拟合曲线。");
                }
                catch (Exception ex)
                {
                    return NXResult.FromException(ex, "型线导入失败");
                }
                finally
                {
                    try { pfb.Destroy(); } catch { }
                }

                try
                {
                    var curve_builder = WorkPart().Features.CreateFitCurveBuilder(FindFeature(CAM_PROFILE_CURVE) as FitCurve) as FitCurveBuilder;
                    curve_builder.IsAssociative = true;
                    curve_builder.TargetSourceType = FitCurveBuilder.TargetSourceTypes.SpecifiedPoints;
                    curve_builder.FittingParameters = FitCurveBuilder.FittingParametersOptions.DegreeAndTolerance;
                    curve_builder.Tolerance = 0.01;
                    curve_builder.Degree = 3;
                    curve_builder.IsClosedBSpline = true;

                    curve_builder.Target.Clear();
                    curve_builder.Target.Add(newPoints.ToArray());

                    var fitFeature = curve_builder.Commit() as Feature;
                    if (fitFeature == null)
                        return NXResult.Fail("拟合曲线失败：Commit 未返回特征。");

                    fitFeature.SetName(CAM_PROFILE_CURVE);

                    try { curve_builder.Destroy(); } catch { }
                }
                catch (Exception ex)
                {
                    return NXResult.FromException(ex, "拟合曲线失败");
                }

                if (point_group != null)
                {
                    Session().UpdateManager.AddToDeleteList((TaggedObject)point_group);
                }

                NXContext.Update();
                return NXResult.Success("生成型线曲线成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "型线导入失败");
            }
        }

        public static NXResult BuildCamLobe(double? CAM_T = null)
        {
            try
            {
                Feature oldLobe = FindFeature(CAM_LOBE_BODY_PREFIX + "1");
                bool isCreate = IsCreate(oldLobe);

                FitCurve profile = FindFeature(CAM_PROFILE_CURVE) as FitCurve;
                if (profile == null)
                    return NXResult.Fail("未找到型线曲线（CAM_PROFILE_CURVE）。请先执行 ImportCamProfile");

                ExtrudeBuilder extrudeBuilder = WorkPart().Features.CreateExtrudeBuilder(oldLobe);

                Section section = WorkPart().Sections.CreateSection(0.00095, 0.001, 0.05);
                extrudeBuilder.Section = section;
                extrudeBuilder.AllowSelfIntersectingSection(true);

                Feature[] feats = new Feature[1] { profile };
                CurveFeatureRule rule = WorkPart().ScRuleFactory.CreateRuleCurveFeature(feats);

                section.SetAllowedEntityTypes(Section.AllowTypes.OnlyCurves);
                SelectionIntentRule[] rules = new SelectionIntentRule[1] { rule };
                section.AddToSection(rules, null, null, null, new Point3d(0.0, 0.0, 0.0), Section.Mode.Create, false);

                // ✅ 参数有效性完全下沉到 ExpressionTools（这里不再做任何判断）
                Expression expr = EnsureExpression(
                    "CAM_T",
                    CAM_T,
                    isCreate,
                    defaultForCreate: 25.0,
                    fallbackForUpdate: null,
                    unit: "MilliMeter",
                    groupName: DRIVER_GROUP_NAME,
                    minInclusive: 1.0,
                    maxInclusive: 1000.0);

                // 仅在新建或显式给参且通过校验时写 RHS（校验失败会被视为缺参 -> 不改 RHS）
                if (isCreate || (CAM_T.HasValue && CAM_T.Value >= 1.0 && CAM_T.Value <= 1000.0))
                    extrudeBuilder.Limits.EndExtend.Value.RightHandSide = $"{extrudeBuilder.Limits.StartExtend.Value.Name}+CAM_T";

                if (isCreate)
                {
                    Point3d origin = new Point3d(0, 0, 0.0);
                    Vector3d vector = new Vector3d(0.0, 0.0, 1.0);
                    Direction direction = WorkPart().Directions.CreateDirection(origin, vector, SmartObject.UpdateOption.WithinModeling);
                    extrudeBuilder.Direction = direction;
                }

                var camLobe = extrudeBuilder.CommitFeature() as BodyFeature;
                if (camLobe == null)
                    return NXResult.Fail("构建/更新凸轮失败：CommitFeature 未返回 BodyFeature。");

                camLobe.SetName(CAM_LOBE_BODY_PREFIX + "1");
                extrudeBuilder.Destroy();

                Update();
                ViewTools.FitView();
                return NXResult.Success(new { CAM_T = expr.Value }, "构建/更新凸轮成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "构建凸轮失败");
            }
        }

        public static NXResult BuildCamshaft(double? CV_LEN = null, double? CV_DIA = null)
        {
            try
            {
                Feature oldShaft = FindFeature(CAM_SHAFT_BODY);
                bool isCreate = IsCreate(oldShaft);

                CylinderBuilder cylinderBuilder = WorkPart().Features.CreateCylinderBuilder(oldShaft);

                Expression exprLen = EnsureExpression("CV_LEN", CV_LEN, isCreate, 700.0, null, "MilliMeter", DRIVER_GROUP_NAME, 1.0, 50000.0);
                Expression exprDia = EnsureExpression("CV_DIA", CV_DIA, isCreate, 40.0, null, "MilliMeter", DRIVER_GROUP_NAME, 0.1, 5000.0);

                if (isCreate || (CV_LEN.HasValue && CV_LEN.Value >= 1.0 && CV_LEN.Value <= 50000.0))
                    cylinderBuilder.Height.RightHandSide = "CV_LEN";

                if (isCreate || (CV_DIA.HasValue && CV_DIA.Value >= 0.1 && CV_DIA.Value <= 5000.0))
                    cylinderBuilder.Diameter.RightHandSide = "CV_DIA";

                if (isCreate)
                {
                    cylinderBuilder.Direction = new Vector3d(0, 0, 1);
                    cylinderBuilder.Origin = new Point3d(0, 0, 0);
                }

                var camShaft = cylinderBuilder.CommitFeature() as BodyFeature;
                if (camShaft == null)
                    return NXResult.Fail("构建/更新凸轮轴体失败：CommitFeature 未返回 BodyFeature。");

                camShaft.SetName(CAM_SHAFT_BODY);
                cylinderBuilder.Destroy();

                Update();
                ViewTools.FitView();
                return NXResult.Success(new { CV_LEN = exprLen?.Value, CV_DIA = exprDia?.Value }, "构建/更新凸轮轴体成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "构建/更新凸轮轴体失败");
            }
        }

        public static NXResult BuildCamBoss(double? CV_BOS_LEN = null, double? CV_BOS_DIA = null)
        {
            try
            {
                Feature oldBoss = FindFeature(CAM_END_BOSS);
                bool isCreate = IsCreate(oldBoss);

                CylinderBuilder cylinderBuilder = WorkPart().Features.CreateCylinderBuilder(oldBoss);

                Expression exprLen = EnsureExpression("CV_BOS_LEN", CV_BOS_LEN, isCreate, 50.0, null, "MilliMeter", DRIVER_GROUP_NAME, 0.1, 50000.0);
                Expression exprDia = EnsureExpression("CV_BOS_DIA", CV_BOS_DIA, isCreate, 50.0, null, "MilliMeter", DRIVER_GROUP_NAME, 0.1, 5000.0);

                if (isCreate || (CV_BOS_LEN.HasValue && CV_BOS_LEN.Value >= 0.1 && CV_BOS_LEN.Value <= 50000.0))
                    cylinderBuilder.Height.RightHandSide = "CV_BOS_LEN";

                if (isCreate || (CV_BOS_DIA.HasValue && CV_BOS_DIA.Value >= 0.1 && CV_BOS_DIA.Value <= 5000.0))
                    cylinderBuilder.Diameter.RightHandSide = "CV_BOS_DIA";

                if (isCreate)
                {
                    cylinderBuilder.Direction = new Vector3d(0, 0, 1);
                    cylinderBuilder.Origin = new Point3d(0, 0, 0);
                }

                var endBoss = cylinderBuilder.CommitFeature() as BodyFeature;
                if (endBoss == null)
                    return NXResult.Fail("构建/更新凸轮轴端部凸台失败：CommitFeature 未返回 BodyFeature。");

                endBoss.SetName(CAM_END_BOSS);
                cylinderBuilder.Destroy();

                Update();
                ViewTools.FitView();
                return NXResult.Success(new { CV_BOS_LEN = exprLen?.Value, CV_BOS_DIA = exprDia?.Value }, "构建/更新凸轮轴端部凸台圆柱成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "构建/更新凸轮轴端部凸台圆柱失败");
            }
        }

        public static NXResult BuildCamLobeArray(int? CYL_QTY = null)
        {
            try
            {
                Feature seedLobe = FindFeature(CAM_LOBE_BODY_PREFIX + "1");
                if (seedLobe == null)
                    return NXResult.Fail("未找到单凸轮。请先执行 BuildCamLobe");

                PatternFeature oldLobeArray = FindFeature(CAM_LOBE_ARRAY) as PatternFeature;
                bool isCreate = oldLobeArray == null;

                PatternFeatureBuilder patternBuilder = WorkPart().Features.CreatePatternFeatureBuilder(oldLobeArray);

                patternBuilder.FeatureList.Clear();
                patternBuilder.FeatureList.Add(new Feature[] { seedLobe });

                patternBuilder.PatternMethod = PatternFeatureBuilder.PatternMethodOptions.Simple;
                patternBuilder.PatternService.PatternType = PatternDefinition.PatternEnum.Circular;

                CircularPattern circular = patternBuilder.PatternService.CircularDefinition;

                Expression exprCount = EnsureExpression("CYL_QTY", CYL_QTY, isCreate, 6, null, "Unitless", DRIVER_GROUP_NAME, 1, 60);

                if (isCreate)
                {
                    circular.AngularSpacing.SpaceType = PatternSpacing.SpacingType.Span;

                    Point3d origin = new Point3d(0, 0, 0);
                    Vector3d vz = new Vector3d(0, 0, 1);
                    Point p0 = WorkPart().Points.CreatePoint(origin);
                    Direction dirZ = WorkPart().Directions.CreateDirection(origin, vz, SmartObject.UpdateOption.WithinModeling);
                    circular.RotationAxis = WorkPart().Axes.CreateAxis(p0, dirZ, SmartObject.UpdateOption.WithinModeling);

                    circular.AngularSpacing.SpanAngle.RightHandSide = "360";
                }

                if (isCreate || (CYL_QTY.HasValue && CYL_QTY.Value >= 1 && CYL_QTY.Value <= 60))
                    circular.AngularSpacing.NCopies.RightHandSide = "CYL_QTY";

                PatternFeature committed = patternBuilder.Commit() as PatternFeature;
                if (committed == null)
                    return NXResult.Fail("凸轮阵列失败：Commit 未返回 PatternFeature。");

                committed.SetName(CAM_LOBE_ARRAY);

                Feature[] contains = committed.GetAllContainedFeatures();
                int index = 2;
                foreach (Feature feat in contains)
                {
                    if (!string.Equals(feat.FeatureType, "Instance Feature", StringComparison.OrdinalIgnoreCase))
                        continue;

                    feat.SetName(CAM_LOBE_BODY_PREFIX + index.ToString(CultureInfo.InvariantCulture));
                    index++;
                }

                patternBuilder.Destroy();

                Update();
                return NXResult.Success(new { CYL_QTY = exprCount.Value }, "构建/更新凸轮阵列成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "构建/更新凸轮阵列失败");
            }
        }

        public static NXResult MountCamLobesToShaft(double? CAM_FIRST_OFFSET = null, double? CYL_PITCH = null)
        {
            try
            {
                // 0) 阵列必须存在
                Feature lobeArray = FindFeature(CAM_LOBE_ARRAY);
                if (lobeArray == null)
                    return NXResult.Fail("未找到凸轮阵列（CAM_LOBE_ARRAY）。请先执行 BuildCamLobeArray");

                // 1) 缸数：只从表达式 CYL_QTY 获取
                Expression exprCyl = FindExpression("CYL_QTY");
                if (exprCyl == null)
                    return NXResult.Fail("未找到表达式 CYL_QTY。请先执行 BuildCamLobeArray");

                int cylQty = (int)Math.Round(exprCyl.Value);
                if (cylQty <= 1)
                    return NXResult.Fail("CYL_QTY<=1：仅有一个凸轮不支持装配。请先生成凸轮阵列（BuildCamLobeArray）");

                // 2) 驱动参数（EnsureExpression 统一收口）
                bool isCreateOffset = (FindExpression("CAM_FIRST_OFFSET") == null);
                bool isCreatePitch = (FindExpression("CYL_PITCH") == null);

                Expression exprOffset = EnsureExpression(
                    "CAM_FIRST_OFFSET", CAM_FIRST_OFFSET, isCreateOffset,
                    defaultForCreate: 30.0, fallbackForUpdate: null,
                    unit: "MilliMeter", groupName: DRIVER_GROUP_NAME,
                    minInclusive: 0.0, maxInclusive: 50000.0);

                Expression exprPitch = EnsureExpression(
                    "CYL_PITCH", CYL_PITCH, isCreatePitch,
                    defaultForCreate: 120.0, fallbackForUpdate: null,
                    unit: "MilliMeter", groupName: DRIVER_GROUP_NAME,
                    minInclusive: 0.0, maxInclusive: 50000.0);

                // 3) CAM_T 必须存在（End = Start + CAM_T）
                if (FindExpression("CAM_T") == null)
                    return NXResult.Fail("未找到表达式 CAM_T。请先执行 BuildCamLobe（生成/更新 CAM_LOBE_BODY_1）");

                // 4) 发火顺序
                int[] firing = GetFiringOrder(cylQty);

                // 5) seed 必须存在，并且必须能取到 Extrude 的 Start/End master expression
                Feature seed = FindFeature(CAM_LOBE_BODY_PREFIX + "1");
                if (seed == null)
                    return NXResult.Fail("未找到单凸轮（CAM_LOBE_BODY_1）。请先执行 BuildCamLobe");

                Expression masterStart = null;
                Expression masterEnd = null;

                ExtrudeBuilder eb = null;
                try
                {
                    eb = WorkPart().Features.CreateExtrudeBuilder(seed);
                    masterStart = eb.Limits.StartExtend.Value;
                    masterEnd = eb.Limits.EndExtend.Value;
                }
                finally
                {
                    try { if (eb != null) eb.Destroy(); } catch { }
                }

                if (masterStart == null || masterEnd == null)
                    return NXResult.Fail("无法获取 CAM_LOBE_BODY_1 的拉伸起止表达式。请确认 CAM_LOBE_BODY_1 为 Extrude 且特征未损坏。");

                // 6) 绑定：seed 直接改 RHS；实例按 journal 编辑实例 RHS（统一入口）
                for (int pos = 0; pos < firing.Length; pos++)
                {
                    int cyl = firing[pos];
                    Feature lobe = FindFeature(CAM_LOBE_BODY_PREFIX + cyl.ToString(CultureInfo.InvariantCulture));
                    if (lobe == null)
                        return NXResult.Fail("未找到同名凸轮对象：" + CAM_LOBE_BODY_PREFIX + cyl);

                    string startRhs = (pos == 0)
                        ? "CAM_FIRST_OFFSET"
                        : $"CAM_FIRST_OFFSET+({pos})*CYL_PITCH";

                    string endRhs = $"({startRhs})+CAM_T";

                    SetLobeStartEndRhs(lobe, masterStart, masterEnd, startRhs, endRhs);
                }

                // 7) 合并（沿用你现有实现，不改变行为/风格）
                BodyFeature shaftFeat = FindFeature(CAM_SHAFT_BODY) as BodyFeature;
                if (shaftFeat == null)
                    return NXResult.Fail("未找到凸轮轴体（CAM_SHAFT_BODY）。请先执行 BuildCamshaft");
                Feature lobeFirst = FindFeature(CAM_LOBE_BODY_PREFIX + "1");
                Feature union = BooleanFeatures(shaftFeat, Feature.BooleanType.Unite, "CAM_SHAFT_UNION", lobeFirst, lobeArray);
                if (union == null)
                    return NXResult.Fail("合并失败：Commit 未返回特征。");

                Update();
                ViewTools.FitView();

                return NXResult.Success(
                    new
                    {
                        CYL_QTY = cylQty,
                        CAM_FIRST_OFFSET = exprOffset?.Value,
                        CYL_PITCH = exprPitch?.Value,
                        firing_order = firing
                    },
                    "凸轮装配成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "凸轮装配失败");
            }
        }

        public static NXResult MountBossToShaft()
        {
            try
            {
                // 1) 必须先有轴体
                BodyFeature shaftFeat = FindFeature(CAM_SHAFT_BODY) as BodyFeature;
                if (shaftFeat == null)
                    return NXResult.Fail("未找到凸轮轴体（CAM_SHAFT_BODY）。请先执行 BuildCamshaft");

                // 2) 必须先有端部凸台
                Feature bossFeat = FindFeature(CAM_END_BOSS);
                if (bossFeat == null)
                    return NXResult.Fail("未找到端部凸台（CAM_END_BOSS）。请先执行 BuildCamBoss");


                // 3) 合并：以轴体为 Target，凸台为 Tool
                Feature union = BooleanFeatures(shaftFeat, Feature.BooleanType.Unite, "CAM_SHAFT_WITH_BOSS", bossFeat);
                if (union == null)
                    return NXResult.Fail("合并失败：Commit 未返回特征。");

                Update();
                ViewTools.FitView();

                return NXResult.Success(new { mounted = true }, "端部凸台合并到轴体成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "端部凸台合并到轴体失败");
            }
        }
        // ===== Journal Face (凹陷轴颈 / 安装面) =====
        // 仅驱动：JF_LEN, JF_SIZE（不兼容旧表达式，不迁移）
        private const string JF_TOOL_OUTER = "JF_TOOL_OUTER_1";
        private const string JF_TOOL_INNER = "JF_TOOL_INNER_1";
        private const string JF_TOOL_RING = "JF_TOOL_RING_1";
        private const string JF_TOOL_ARRAY = "JF_TOOL_ARRAY";
        private const string JF_TOOL_PRE = "JF_TOOL_PRE_1";
        private const string JF_TOOL_POST = "JF_TOOL_POST_1";
        private const string JF_CUT = "CAM_SHAFT_JOURNALFACE_CUT";

        public static NXResult BuildJournalFace(double? JF_LEN = null, double? JF_SIZE = null)
        {
            try
            {
                // 0) 轴体必须存在
                Feature shaftFeat = FindFeature(CAM_SHAFT_BODY);
                if (shaftFeat == null)
                    return NXResult.Fail("未找到凸轮轴体（CAM_SHAFT_BODY）。请先执行 BuildCamshaft");

                BodyFeature shaftBf = shaftFeat as BodyFeature;
                if (shaftBf == null || shaftBf.GetBodies() == null || shaftBf.GetBodies().Length == 0)
                    return NXResult.Fail("凸轮轴体无有效实体（CAM_SHAFT_BODY）。");

                Body shaftBody = shaftBf.GetBodies()[0];

                // 1) 必要表达式（不猜、不兜底）
                Expression eCylQty = FindExpression("CYL_QTY");
                if (eCylQty == null) return NXResult.Fail("未找到表达式 CYL_QTY。请先执行 BuildCamLobeArray/装配流程");

                Expression ePitch = FindExpression("CYL_PITCH");
                if (ePitch == null) return NXResult.Fail("未找到表达式 CYL_PITCH。请先执行装配流程（应建立 CYL_PITCH）");

                Expression eFirstOffset = FindExpression("CAM_FIRST_OFFSET");
                if (eFirstOffset == null) return NXResult.Fail("未找到表达式 CAM_FIRST_OFFSET。请先执行装配流程（应建立 CAM_FIRST_OFFSET）");

                Expression eCamT = FindExpression("CAM_T");
                if (eCamT == null) return NXResult.Fail("未找到表达式 CAM_T。请先执行 BuildCamLobe");

                Expression eCvDia = FindExpression("CV_DIA");
                if (eCvDia == null) return NXResult.Fail("未找到表达式 CV_DIA。请先执行 BuildCamshaft");

                Expression eCvLen = FindExpression("CV_LEN");
                if (eCvLen == null) return NXResult.Fail("未找到表达式 CV_LEN。请先执行 BuildCamshaft");

                int cylQty = (int)Math.Round(eCylQty.Value);
                if (cylQty <= 1)
                    return NXResult.Fail("CYL_QTY<=1：无相邻凸轮区间，无法创建轴颈。");

                // 2) 唯二驱动变量：JF_LEN / JF_SIZE（不兼容旧表达式，不迁移）
                bool createLen = (FindExpression("JF_LEN") == null);
                bool createSize = (FindExpression("JF_SIZE") == null);

                Expression eJfLen = EnsureExpression(
                    "JF_LEN", JF_LEN, createLen,
                    defaultForCreate: 30.0, fallbackForUpdate: null,
                    unit: "MilliMeter", groupName: DRIVER_GROUP_NAME,
                    minInclusive: 0.1, maxInclusive: 50000.0);

                Expression eJfSize = EnsureExpression(
                    "JF_SIZE", JF_SIZE, createSize,
                    defaultForCreate: 2.0, fallbackForUpdate: null,
                    unit: "MilliMeter", groupName: DRIVER_GROUP_NAME,
                    minInclusive: 0.01, maxInclusive: 2000.0);

                // 3) 计算（数值）第一个“凸轮区轴颈”起点 Z
                // 你给的原则：首个轴颈正好落在第1/第2凸轮中心之间
                // lobe1 center = CAM_FIRST_OFFSET + CAM_T/2
                // lobe2 center = CAM_FIRST_OFFSET + CYL_PITCH + CAM_T/2
                // mid = CAM_FIRST_OFFSET + CAM_T/2 + CYL_PITCH/2
                // start = mid - JF_LEN/2
                double offset = eFirstOffset.Value;
                double pitch = ePitch.Value;
                double camT = eCamT.Value;
                double jfLen = eJfLen.Value;

                double midZ = offset + 0.5 * camT + 0.5 * pitch;
                double midStartZ = midZ - 0.5 * jfLen;

                // 4) 构建“套筒刀具体（凹陷，不掏空）”的 seed：outer/inner -> ring
                // outer: DIA=CV_DIA, LEN=JF_LEN
                // inner: DIA=CV_DIA-2*JF_SIZE, LEN=JF_LEN
                BodyFeature outerSeed = BuildOrUpdateCylinderAtZ(JF_TOOL_OUTER, "CV_DIA", "JF_LEN", midStartZ);
                BodyFeature innerSeed = BuildOrUpdateCylinderAtZ(JF_TOOL_INNER, "CV_DIA-2*JF_SIZE", "JF_LEN", midStartZ);

                // ring = outer - inner（得到套筒）
                BodyFeature ringSeed = BuildOrUpdateRingTool(JF_TOOL_RING, outerSeed, innerSeed);

                // 5) 凸轮区阵列（Linear/Rectangular，沿Z）
                // NCopies = CYL_QTY - 1（相邻凸轮之间）
                // Pitch = CYL_PITCH
                PatternFeature ringArray = BuildOrUpdateLinearPatternAlongZ(
                    JF_TOOL_ARRAY,
                    ringSeed,
                    nCopiesRhs: "CYL_QTY-1",
                    pitchRhs: "CYL_PITCH"
                );

                // 6) 端部：前/后端各最多 1 个（无凸台不报错；有凸台才纳入干涉判断）
                // 判定只做轴向区间（低冗余、稳定）：能放下就放，放不下就跳过
                // bossLen：如果表达式存在就用；否则认为 0（无凸台）
                double bossLen = 0.0;
                Expression eBosLen = FindExpression("CV_BOS_LEN");
                if (eBosLen != null) bossLen = eBosLen.Value;

                double cvLen = eCvLen.Value;

                // 第一凸轮轴向区间：[offset, offset+camT]
                double lobe1Start = offset;
                double lobe1End = offset + camT;

                // 最后一凸轮区间：[offset+(cylQty-1)*pitch, +camT]
                double lastLobeStart = offset + (cylQty - 1) * pitch;
                double lastLobeEnd = lastLobeStart + camT;

                // 前端可用区间：[bossLen, lobe1Start]，居中放置一个 JF_LEN
                BodyFeature preRing = null;
                if (TryCenteredStart(bossLen, lobe1Start, jfLen, out double preStartZ))
                {
                    // 不越界、且不与第一个凸轮区间重叠
                    if (preStartZ >= bossLen && preStartZ + jfLen <= cvLen &&
                        !Overlap1D(preStartZ, preStartZ + jfLen, lobe1Start, lobe1End))
                    {
                        preRing = BuildOrUpdateJournalRingAtZ(JF_TOOL_PRE, preStartZ);
                    }
                }

                // 后端可用区间：[lastLobeEnd, cvLen]，居中放置一个 JF_LEN
                BodyFeature postRing = null;
                if (TryCenteredStart(lastLobeEnd, cvLen, jfLen, out double postStartZ))
                {
                    if (postStartZ >= 0.0 && postStartZ + jfLen <= cvLen &&
                        !Overlap1D(postStartZ, postStartZ + jfLen, lastLobeStart, lastLobeEnd))
                    {
                        postRing = BuildOrUpdateJournalRingAtZ(JF_TOOL_POST, postStartZ);
                    }
                }

                // 7) 一次性切削：shaft - (ringArray + ringSeed + pre? + post?)
                // 注意：pattern 选上通常能覆盖实例，但我仍把 seed 加进去，避免 seed 漏选
                var tools = new List<Feature>();
                if (ringArray != null) tools.Add(ringArray);
                if (ringSeed != null) tools.Add(ringSeed);
                if (preRing != null) tools.Add(preRing);
                if (postRing != null) tools.Add(postRing);

                Feature cut = BooleanFeatures(shaftBody, Feature.BooleanType.Subtract, JF_CUT, tools.ToArray());
                if (cut == null)
                    return NXResult.Fail("轴颈切削失败：Commit 未返回特征。请检查 JF_SIZE 是否过大导致 CV_DIA-2*JF_SIZE 无效。");

                Update();
                ViewTools.FitView();


                // 8) 隐藏构建 ring 特征所用的基础实体（避免 seed 体干扰显示）
                // 仅隐藏 outer/inner（含端部 pre/post 的 outer/inner），保留 ring / pattern / cut 便于后续更新
                HideFeatureBodiesSafe(JF_TOOL_OUTER);
                HideFeatureBodiesSafe(JF_TOOL_INNER);
                HideFeatureBodiesSafe(JF_TOOL_PRE + "_OUTER");
                HideFeatureBodiesSafe(JF_TOOL_PRE + "_INNER");
                HideFeatureBodiesSafe(JF_TOOL_POST + "_OUTER");
                HideFeatureBodiesSafe(JF_TOOL_POST + "_INNER");

                Update();

                return NXResult.Success(new
                {
                    CYL_QTY = cylQty,
                    JF_LEN = eJfLen.Value,
                    JF_SIZE = eJfSize.Value,
                    pre_enabled = (preRing != null),
                    post_enabled = (postRing != null)
                }, "BuildJournalFace：凹陷轴颈构建/更新成功（不使用 Move，仅 JF_LEN/JF_SIZE）");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "BuildJournalFace：凹陷轴颈构建/更新失败");
            }

            // ---- local helper: 隐藏某个特征所产生的实体（找不到则忽略）----
            void HideFeatureBodiesSafe(string featureName)
            {
                try
                {
                    Feature f = FindFeature(featureName);
                    if (f == null) return;

                    BodyFeature bf = f as BodyFeature;
                    if (bf == null) return;

                    Body[] bodies = bf.GetBodies();
                    if (bodies == null || bodies.Length == 0) return;

                    foreach (Body b in bodies)
                    {
                        if (b != null) b.Blank();
                    }
                }
                catch
                {
                    // ignore: 仅影响显示，不影响建模/更新
                }
            }

            // ---- local helper: 复用同一套 outer/inner/ring 构造（不新增表达式变量）----
            BodyFeature BuildOrUpdateJournalRingAtZ(string ringName, double startZ)
            {
                // 为了低冗余：端部 ring 直接复用同一组 RHS（CV_DIA / CV_DIA-2*JF_SIZE / JF_LEN）
                string outerName = ringName + "_OUTER";
                string innerName = ringName + "_INNER";

                BodyFeature outer = BuildOrUpdateCylinderAtZ(outerName, "CV_DIA", "JF_LEN", startZ);
                BodyFeature inner = BuildOrUpdateCylinderAtZ(innerName, "CV_DIA-2*JF_SIZE", "JF_LEN", startZ);
                BodyFeature ring = BuildOrUpdateRingTool(ringName, outer, inner);
                return ring;
            }
        }

        /// <summary>
        /// 在给定 startZ（数值）处创建/更新圆柱体。不会生成 Move 特征；位置由 Origin 数值直接指定。
        /// 直径/长度使用 RHS（表达式）保证尺寸参数化；Z 位置由本工具每次运行重算更新（符合你们工具原子更新风格）。
        /// </summary>
        private static BodyFeature BuildOrUpdateCylinderAtZ(string featureName, string diaRhs, string lenRhs, double startZ)
        {
            Feature old = FindFeature(featureName);
            bool isCreate = (old == null);

            CylinderBuilder cb = WorkPart().Features.CreateCylinderBuilder(old);
            cb.Diameter.RightHandSide = diaRhs;
            cb.Height.RightHandSide = lenRhs;

            if (isCreate)
            {
                cb.Direction = new Vector3d(0, 0, 1);
                cb.Origin = new Point3d(0, 0, startZ);
            }
            else
            {
                // 更新时也强制把 Origin 重置到当前 startZ（你要求“重置当前程序”）
                cb.Origin = new Point3d(0, 0, startZ);
                cb.Direction = new Vector3d(0, 0, 1);
            }

            BodyFeature bf = cb.CommitFeature() as BodyFeature;
            cb.Destroy();

            if (bf == null) throw new InvalidOperationException("BuildOrUpdateCylinderAtZ：CommitFeature 未返回 BodyFeature。");

            bf.SetName(featureName);
            return bf;
        }

        /// <summary>
        /// 环形套筒工具：outer - inner。用于凹陷轴颈，避免“实心圆柱减料导致掏空孔”。
        /// </summary>
        private static BodyFeature BuildOrUpdateRingTool(string ringName, BodyFeature outerTool, BodyFeature innerTool)
        {
            if (outerTool == null || innerTool == null)
                throw new ArgumentNullException("BuildOrUpdateRingTool：outer/inner 为空。");

            Feature old = FindFeature(ringName);

            // ring = outer - inner
            Feature ringFeat = BooleanFeatures(outerTool, Feature.BooleanType.Subtract, ringName, innerTool);
            BodyFeature ringBf = ringFeat as BodyFeature;
            if (ringBf == null)
                throw new InvalidOperationException("BuildOrUpdateRingTool：Subtract 未返回 BodyFeature。");

            ringBf.SetName(ringName);
            return ringBf;
        }

        /// <summary>
        /// Linear Pattern（Rectangular 1D）：沿全局Z阵列
        /// 注意：你当前 CamshaftTools 里已有 PatternBuilder 用法，这里保持同一风格。
        /// </summary>
        private static PatternFeature BuildOrUpdateLinearPatternAlongZ(string patternName, Feature seedFeature, string nCopiesRhs, string pitchRhs)
        {
            PatternFeature old = FindFeature(patternName) as PatternFeature;

            PatternFeatureBuilder pb = WorkPart().Features.CreatePatternFeatureBuilder(old);
            pb.FeatureList.Clear();
            pb.FeatureList.Add(new Feature[] { seedFeature });

            pb.PatternMethod = PatternFeatureBuilder.PatternMethodOptions.Simple;
            pb.PatternService.PatternType = PatternDefinition.PatternEnum.Linear;

            RectangularPattern rect = pb.PatternService.RectangularDefinition;

            // Z 方向
            Point3d origin = new Point3d(0, 0, 0);
            Vector3d vz = new Vector3d(0, 0, 1);
            Direction dirZ = WorkPart().Directions.CreateDirection(origin, vz, SmartObject.UpdateOption.WithinModeling);

            rect.XDirection = dirZ;
            rect.XSpacing.SpaceType = PatternSpacing.SpacingType.Pitch;
            rect.XSpacing.NCopies.RightHandSide = nCopiesRhs;
            rect.XSpacing.PitchDistance.RightHandSide = pitchRhs;

            // Y 不阵列
            rect.YSpacing.SpaceType = PatternSpacing.SpacingType.Pitch;
            rect.YSpacing.NCopies.RightHandSide = "1";
            rect.YSpacing.PitchDistance.RightHandSide = "1";

            PatternFeature committed = pb.Commit() as PatternFeature;
            pb.Destroy();

            if (committed == null)
                throw new InvalidOperationException("BuildOrUpdateLinearPatternAlongZ：Commit 未返回 PatternFeature。");

            committed.SetName(patternName);
            return committed;
        }

        // ---- 端部“能放就放，放不下/干涉就跳过” 的最小判定（无额外变量）----
        private static bool TryCenteredStart(double zoneStart, double zoneEnd, double segLen, out double startZ)
        {
            startZ = 0.0;
            if (zoneEnd <= zoneStart) return false;
            double avail = zoneEnd - zoneStart;
            if (avail < segLen) return false;
            startZ = zoneStart + 0.5 * (avail - segLen);
            return true;
        }

        private static bool Overlap1D(double a0, double a1, double b0, double b1)
        {
            double left = Math.Max(Math.Min(a0, a1), Math.Min(b0, b1));
            double right = Math.Min(Math.Max(a0, a1), Math.Max(b0, b1));
            return right > left;
        }

        private static void SetLobeStartEndRhs(
            Feature lobeFeat,
            Expression masterStartExpr,
            Expression masterEndExpr,
            string startRhs,
            string endRhs)
        {
            if (lobeFeat == null)
                throw new ArgumentNullException(nameof(lobeFeat));
            if (masterStartExpr == null || masterEndExpr == null)
                throw new InvalidOperationException("masterStartExpr/masterEndExpr 为空，无法绑定 Start/End。");

            // seed（Extrude）：直接改 master RHS
            if (string.Equals(lobeFeat.FeatureType, "Extrude", StringComparison.OrdinalIgnoreCase))
            {
                masterStartExpr.RightHandSide = startRhs;
                masterEndExpr.RightHandSide = endRhs;
                return;
            }

            // instance：编辑实例对 master expr 的 RHS
            var inst = lobeFeat as NXOpen.Features.InstanceFeature;
            if (inst == null)
                throw new InvalidOperationException("凸轮既不是 Extrude 也不是 Instance Feature，无法设置 Start/End。当前类型=" + lobeFeat.FeatureType);

            NXOpen.Features.InstanceFeatureBuilder ib = null;
            try
            {
                ib = WorkPart().Features.CreateInstanceFeatureBuilder(new[] { inst }, false);
                Expression nullExpr = null;

                var itemStart = ib.EditedExpressionsList.EditInstanceExpression(masterStartExpr, nullExpr);
                ib.EditedExpressionsList.List.Append(itemStart);
                itemStart.ValueExpression.RightHandSide = startRhs;

                var itemEnd = ib.EditedExpressionsList.EditInstanceExpression(masterEndExpr, nullExpr);
                ib.EditedExpressionsList.List.Append(itemEnd);
                itemEnd.ValueExpression.RightHandSide = endRhs;

                ib.Commit();
            }
            finally
            {
                try { if (ib != null) ib.Destroy(); } catch { }
            }
        }


    }
}
