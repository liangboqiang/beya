using NXOpen;
using NXOpen.Features;
using NXOpen.UF;
using System;
using System.Collections.Generic;
using System.Globalization;
using NXSDK;
using static NXSDK.StringHelper;
using static NXSDK.NXContext;

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
    public static class ModelingTools
    {
        public static int DeleteNXObjectByPrefix(NXObject[] objects, string _prefix)
        {
            if (objects == null || objects.Length == 0) return 0;

            var list = new List<NXObject>();
            for (int i = 0; i < objects.Length; i++)
            {
                if (objects[i].Name.StartsWith(_prefix, StringComparison.OrdinalIgnoreCase)) list.Add(objects[i]);
            }
            if (list.Count == 0) return 0;
            return Session().UpdateManager.AddToDeleteList((NXObject[])list.ToArray()); ;
        }

        /// 通过逻辑名精确回找 Feature（扫描 Name）。
        /// </summary>
        public static Feature FindFeature(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            foreach (Feature feat in WorkPart().Features)
            {
                if (string.Equals(feat.Name, name, StringComparison.OrdinalIgnoreCase))
                    return feat;
            }
            return null;
        }
        public static NXObject FindObjectByFeature(string name)
        {
            Feature feat =  FindFeature(name);
            return feat?.GetEntities()[0];
        }

        public static int[] GetFiringOrder(int cylQty)
        {
            // 只支持明确的常用缸数；不做“猜测式”推断，避免把错误的顺序绑定到参数化表达式里
            switch (cylQty)
            {
                case 4:
                    // 典型直列4缸：1-3-4-2
                    return new[] { 1, 3, 4, 2 };

                case 6:
                    // 典型直列6缸：1-5-3-6-2-4
                    return new[] { 1, 5, 3, 6, 2, 4 };

                case 8:
                    // 常见 V8（小缸体 Chevy 等）顺序之一：1-8-4-3-6-5-7-2
                    // 如果你们业务固定另一套顺序，就把这里改成你们的标准即可
                    return new[] { 1, 8, 4, 3, 6, 5, 7, 2 };

                default:
                    throw new InvalidOperationException("不支持的缸数 CYL_QTY=" + cylQty + "。GetFiringOrder 仅支持 4/6/8 缸。");
            }
        }


        public static Feature BooleanFeatures(BodyFeature bodyFeature, Feature.BooleanType operarion, string resultName = null, params Feature[] toolFeats)
        {
            Body body = GetFirstBody(bodyFeature);
            return BooleanFeatures(body, operarion, resultName,  toolFeats);
        }

        public static Feature BooleanFeatures(Body body, Feature.BooleanType operarion, string resultName = null,  params Feature[] toolFeats)
        {
            if (body == null)
                throw new ArgumentNullException(nameof(body));

            var bb = WorkPart().Features.CreateBooleanBuilderUsingCollector(null);
            bb.Operation = operarion;
            bb.Tolerance = 0.001;

            bb.Targets.Add(body);

            var collector = WorkPart().ScCollectors.CreateCollector();
            var rules = new List<SelectionIntentRule>();

            if (toolFeats != null)
            {
                foreach (var f in toolFeats)
                {
                    if (f == null) continue;
                    rules.Add(WorkPart().ScRuleFactory.CreateRuleBodyFeature(new Feature[] { f }, false));
                }
            }

            collector.ReplaceRules(rules.ToArray(), false);
            bb.ToolBodyCollector = collector;
            // 1) Commit 后得到 booleanFeat
            BooleanFeature booleanFeat = bb.Commit() as BooleanFeature;
            bb.Destroy();
            if (booleanFeat == null) throw new InvalidOperationException("BooleanFeatures：Commit 未返回 Feature。");

            var xb = WorkPart().Features.CreateExtractFaceBuilder(null);
            xb.Type = ExtractFaceBuilder.ExtractType.Body;

            ScCollector sc = xb.ExtractBodyCollector;

            Feature[] feats = new Feature[1];
            feats[0] = booleanFeat;
            BodyFeatureRule bodyFeatureRule = WorkPart().ScRuleFactory.CreateRuleBodyFeature(feats);

            SelectionIntentRule[] scRules = new NXOpen.SelectionIntentRule[1];
            scRules[0] = bodyFeatureRule;
            sc.ReplaceRules(scRules, false);


            Feature extracted = xb.CommitFeature();
            xb.Destroy();

            // 4) 命名并返回抽取体特征（用于阵列）
            if (!string.IsNullOrEmpty(resultName)) extracted.SetName(resultName);
            return extracted;
        }

        private static Body GetFirstBody(BodyFeature bf)
        {
            if (bf == null) return null;
            Body[] bodies = bf.GetBodies();
            if (bodies == null || bodies.Length == 0) return null;
            return bodies[0];
        }

        /*        private static void EnsureDatumSystem()
                {
                    Point origin = ModelingBaseTools.EnsureNamedPoint(WorkPart(), CAM_DATUM_PNT_O, new Point3d(0, 0, 0));
                    if (origin == null) return;

                    Axis axisZ = ModelingBaseTools.EnsureNamedAxisZ(WorkPart(), CAM_DATUM_AXIS_Z, origin, new Vector3d(0, 0, 1));
                    // 允许 axisZ 为 null（best-effort）
                }*/

    }
}
