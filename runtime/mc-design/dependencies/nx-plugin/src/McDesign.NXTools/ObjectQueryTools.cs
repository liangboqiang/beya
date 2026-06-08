using NXOpen;
using System;

namespace NXTools
{
    /// <summary>
    /// Helper：对象定位、特征查找、命名稳定化（不对外暴露为工具）
    /// </summary>
    public static class ObjectQueryTools
    {
        public static TaggedObject GetTaggedObject(int tag)
        {
            return (TaggedObject)NXOpen.Utilities.NXObjectManager.Get((NXOpen.Tag)tag);
        }

        public static Body FindBodyByTag(int tag)
        {
            return GetTaggedObject(tag) as Body;
        }

        public static Curve FindCurveByTag(int tag)
        {
            return GetTaggedObject(tag) as Curve;
        }

        public static NXOpen.Features.Feature FindFeatureByName(Part part, string featureName)
        {
            if (part == null) throw new ArgumentNullException(nameof(part));
            if (string.IsNullOrWhiteSpace(featureName)) return null;

            foreach (var f in part.Features.ToArray())
            {
                if (f != null && string.Equals(f.Name, featureName, StringComparison.Ordinal))
                    return f;
            }
            return null;
        }

        public static void TrySetFeatureName(NXOpen.Features.Feature feature, string desiredName)
        {
            if (feature == null) return;
            if (string.IsNullOrWhiteSpace(desiredName)) return;
            try { feature.SetName(desiredName); } catch { }
        }

        public static string MakeStableName(string standardName)
        {
            // 标准化命名：不再拼接随机后缀；由工具做“存在则更新，不存在则创建”
            // NX 若仍强制追加 _01，这会在工具内部被捕获并回传 actualName
            return standardName;
        }

        public static Body TryGetFirstBodyFromFeature(NXOpen.Features.Feature feature)
        {
            if (feature == null) return null;
            try
            {
                var ents = feature.GetEntities();
                if (ents == null) return null;
                foreach (var e in ents)
                {
                    var b = e as Body;
                    if (b != null) return b;
                }
            }
            catch { }
            return null;
        }
    }
}
