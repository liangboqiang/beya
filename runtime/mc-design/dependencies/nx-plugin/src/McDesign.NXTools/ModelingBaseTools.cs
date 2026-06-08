using NXOpen;
using NXOpen.Features;
using NXOpen.UF;
using System;
using System.Collections.Generic;
using System.Globalization;
using NXSDK;
using static NXSDK.StringHelper;

namespace NXTools
{
    /// <summary>
    /// 建模基础工具（不对外暴露为 Tool）
    /// 目标：
    /// 1) 统一 Session/WorkPart 获取；
    /// 2) 提供“逻辑名(Name体系) -> FeatureName(系统唯一)”映射与回找；
    /// 3) 提供 NXObject 删除（UpdateManager.AddToDeleteList）；
    /// 4) 提供常用建模辅助（bbox、feature->bodies、named datum 等）。
    /// </summary>
    public static class ModelingBaseTools
    {
        // =========================
        // Session / Part



        // =========================
        // FeatureName 映射：逻辑名 -> FeatureName
        // FeatureName 示例："Fit Curve(1)"，可用于 part.Features.FindObject("Fit Curve(1)")
        // =========================
        private const string FEATURENAME_MAP_ATTR_PREFIX = "__NXTOOLS_FEATURENAME__:";

        private static string FeatureNameAttrKey(string logicalName)
        {
            logicalName = SafeTrim(logicalName);
            return FEATURENAME_MAP_ATTR_PREFIX + logicalName;
        }

        /// <summary>
        /// 记录：逻辑名 -> FeatureName
        /// </summary>
        public static void RememberFeature(Part part, Feature feature, string logicalName)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            if (feature == null) throw new ArgumentNullException(nameof(feature));
            logicalName = SafeTrim(logicalName);
            if (logicalName.Length == 0) return;

            string featureName;
            try { featureName = feature.GetFeatureName(); }
            catch { featureName = null; }

            if (string.IsNullOrWhiteSpace(featureName)) return;

            try
            {
                PartAttributeTools.SetString(FeatureNameAttrKey(logicalName), featureName);
            }
            catch
            {
                // best-effort：不让映射失败影响主流程
            }
        }

        /// <summary>
        /// 通过逻辑名精确回找 Feature（优先 FeatureName 映射，其次扫描 Name 作为兜底）。
        /// </summary>
        public static Feature FindFeatureByLogicalName(Part part, string logicalName)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            logicalName = SafeTrim(logicalName);
            if (logicalName.Length == 0) return null;

            // 1) 优先：从属性里读取 FeatureName
            string mappedFeatureName = null;
            try { mappedFeatureName = PartAttributeTools.GetString(FeatureNameAttrKey(logicalName)); }
            catch { mappedFeatureName = null; }

            mappedFeatureName = SafeTrim(mappedFeatureName);
            if (mappedFeatureName.Length > 0)
            {
                try
                {
                    // FindObject 支持 FeatureName，例如 "Fit Curve(1)"
                    NXObject obj = part.Features.FindObject(mappedFeatureName);
                    Feature f = obj as Feature;
                    if (f != null) return f;
                }
                catch
                {
                    // 可能已被删除/变更，继续兜底
                }
            }

            // 2) 次选：如果 logicalName 本身就是 FeatureName（包含 "(1)" 等），直接 FindObject
            if (logicalName.IndexOf('(') >= 0 && logicalName.IndexOf(')') >= 0)
            {
                try
                {
                    NXObject obj = part.Features.FindObject(logicalName);
                    Feature f = obj as Feature;
                    if (f != null) return f;
                }
                catch { }
            }

            // 3) 兜底：扫描 feature.Name（注意：Name 非唯一，只作为兜底）
            try
            {
                foreach (Feature f in part.Features)
                {
                    if (f == null) continue;
                    string n = SafeTrim(f.Name);
                    if (string.Equals(n, logicalName, StringComparison.OrdinalIgnoreCase))
                        return f;
                }
            }
            catch { }

            return null;
        }

        /// <summary>
        /// 设置 feature.Name（逻辑名）并同步记录 FeatureName 映射。
        /// </summary>
        public static void SetLogicalNameAndRemember(Part part, Feature feature, string logicalName)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            if (feature == null) throw new ArgumentNullException(nameof(feature));
            logicalName = SafeTrim(logicalName);
            if (logicalName.Length == 0) return;

            try { feature.SetName(logicalName); }
            catch { /* best-effort */ }

            RememberFeature(part, feature, logicalName);
        }

        // =========================
        // Delete：严格按 UpdateManager.AddToDeleteList
        // =========================

        /// <summary>
        /// 使用 UpdateManager.AddToDeleteList 删除对象（符合你要求的删除路径）。
        /// 返回 nErrs（NX 报告的删除错误数）。
        /// </summary>
        public static int DeleteObjectsByUpdateManager(params NXObject[] objects)
        {
            if (objects == null || objects.Length == 0) return 0;

            Session session = NXContext.Session();

            var list = new List<NXObject>();
            for (int i = 0; i < objects.Length; i++)
            {
                if (objects[i] != null) list.Add(objects[i]);
            }
            if (list.Count == 0) return 0;

            int nErrs = 0;
            try
            {
                // 关键：按你给的标准写法
                nErrs = session.UpdateManager.AddToDeleteList((NXObject[])list.ToArray());
                var mark = session.SetUndoMark(Session.MarkVisibility.Invisible, "DeleteObjects");
                session.UpdateManager.DoUpdate(mark);
            }
            catch
            {
                // best-effort
            }
            return nErrs;
        }

        // =========================
        // BoundingBox（NX11：UF Modl.AskBoundingBox）
        // =========================
        public static double[] AskBoundingBox(TaggedObject obj)
        {
            double[] box = new double[6];
            if (obj == null) return box;

            try
            {
                NXContext.UF().Modl.AskBoundingBox(obj.Tag, box);
            }
            catch
            {
                // 返回默认 0
            }
            return box;
        }

        // =========================
        // Feature -> Bodies
        // =========================
        public static List<Body> GetSolidBodiesFromFeature(Feature feature)
        {
            var NXResult = new List<Body>();
            if (feature == null) return NXResult;

            try
            {
                NXObject[] entities = feature.GetEntities();
                if (entities == null) return NXResult;

                for (int i = 0; i < entities.Length; i++)
                {
                    Body b = entities[i] as Body;
                    if (b == null) continue;
                    try
                    {
                        if (b.IsSolidBody) NXResult.Add(b);
                    }
                    catch { }
                }
            }
            catch { }

            return NXResult;
        }

        public static Body TryGetFirstSolidBodyFromFeature(Feature feature)
        {
            var bodies = GetSolidBodiesFromFeature(feature);
            return bodies.Count > 0 ? bodies[0] : null;
        }

        // =========================
        // Named Datum helpers（通用下沉）
        // =========================
        public static Point EnsureNamedPoint(Part part, string pointName, Point3d position)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            pointName = SafeTrim(pointName);
            if (pointName.Length == 0) return null;

            // 若存在同名点：直接复用（不强行改坐标，避免 API 差异）
            try
            {
                foreach (Point p in part.Points)
                {
                    if (p == null) continue;
                    if (string.Equals(SafeTrim(p.Name), pointName, StringComparison.OrdinalIgnoreCase))
                        return p;
                }
            }
            catch { }

            try
            {
                Point p = part.Points.CreatePoint(position);
                try { p.SetName(pointName); } catch { }
                return p;
            }
            catch
            {
                return null;
            }
        }

        public static Axis EnsureNamedAxisZ(Part part, string axisName, Point axisPoint, Vector3d directionVector)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            axisName = SafeTrim(axisName);
            if (axisName.Length == 0) return null;

            try
            {
                foreach (Axis ax in part.Axes)
                {
                    if (ax == null) continue;
                    if (string.Equals(SafeTrim(ax.Name), axisName, StringComparison.OrdinalIgnoreCase))
                        return ax;
                }
            }
            catch { }

            try
            {
                Direction dir = part.Directions.CreateDirection(
                    new Point3d(0, 0, 0),
                    directionVector,
                    SmartObject.UpdateOption.WithinModeling
                );

                Axis axis = part.Axes.CreateAxis(axisPoint, dir, SmartObject.UpdateOption.WithinModeling);
                try { axis.SetName(axisName); } catch { }
                return axis;
            }
            catch
            {
                return null;
            }
        }

        // =========================
        // 数值字符串（统一 Invariant）
        // =========================


        // =========================
        // 反射设置枚举（兼容 NXOpen 某些 Builder 的枚举属性在不同版本层级不同）
        // =========================
        public static bool TrySetEnumOnNested(object root, string nestedPropertyName, string enumPropertyName, string enumName)
        {
            if (root == null) return false;
            if (string.IsNullOrWhiteSpace(nestedPropertyName)) return false;
            if (string.IsNullOrWhiteSpace(enumPropertyName)) return false;
            if (string.IsNullOrWhiteSpace(enumName)) return false;

            try
            {
                var t = root.GetType();
                var pNested = t.GetProperty(nestedPropertyName);
                if (pNested == null) return false;

                object nested = pNested.GetValue(root, null);
                if (nested == null) return false;

                var t2 = nested.GetType();
                var pEnum = t2.GetProperty(enumPropertyName);
                if (pEnum == null) return false;

                var enumType = pEnum.PropertyType;
                if (!enumType.IsEnum) return false;

                object val = Enum.Parse(enumType, enumName, true);
                pEnum.SetValue(nested, val, null);
                return true;
            }
            catch
            {
                return false;
            }
        }

        // =========================
        // 布尔：Unite / Subtract（基于 NX11 Journal 的 CreateBooleanBuilderUsingCollector 写法）
        // =========================
        public static Feature BooleanUniteBodies(Part part, Feature oldBooleanFeature, Body target, List<Body> toolBodies)
        {
            return BooleanOperateBodies(part, oldBooleanFeature, Feature.BooleanType.Unite, target, toolBodies);
        }

        public static Feature BooleanSubtractBodies(Part part, Feature oldBooleanFeature, Body target, List<Body> toolBodies)
        {
            return BooleanOperateBodies(part, oldBooleanFeature, Feature.BooleanType.Subtract, target, toolBodies);
        }

        private static Feature BooleanOperateBodies(Part part, Feature oldBooleanFeature, Feature.BooleanType op, Body target, List<Body> toolBodies)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            if (target == null) throw new ArgumentNullException(nameof(target));
            if (toolBodies == null) toolBodies = new List<Body>();

            // 过滤空、过滤 target 自己
            var tools = new List<Body>();
            for (int i = 0; i < toolBodies.Count; i++)
            {
                Body b = toolBodies[i];
                if (b == null) continue;
                if (b.Tag == target.Tag) continue;
                try { if (!b.IsSolidBody) continue; } catch { }
                tools.Add(b);
            }
            if (tools.Count == 0) return oldBooleanFeature;

            BooleanBuilder bb = null;
            try
            {
                bb = part.Features.CreateBooleanBuilderUsingCollector(oldBooleanFeature as BooleanFeature);
                bb.Tolerance = 0.01;
                bb.Operation = op;

                // target
                bb.Targets.Add(target);
                try
                {
                    bb.BooleanRegionSelect.AssignTargets(new TaggedObject[] { target });
                }
                catch { }

                // tools collector
                ScCollector toolCollector = null;
                try { toolCollector = bb.ToolBodyCollector; } catch { toolCollector = null; }
                if (toolCollector == null)
                {
                    try
                    {
                        toolCollector = part.ScCollectors.CreateCollector();
                        bb.ToolBodyCollector = toolCollector;
                    }
                    catch { }
                }

                if (toolCollector != null)
                {
                    BodyDumbRule r = part.ScRuleFactory.CreateRuleBodyDumb(tools.ToArray(), true);
                    toolCollector.ReplaceRules(new SelectionIntentRule[] { r }, false);
                }

                Feature f = bb.CommitFeature();
                return f;
            }
            catch
            {
                return oldBooleanFeature;
            }
            finally
            {
                try { if (bb != null) bb.Destroy(); } catch { }
            }
        }

        public static string ToInvariant(double v)
        {
            return v.ToString("0.###############", CultureInfo.InvariantCulture);
        }
    }
}
