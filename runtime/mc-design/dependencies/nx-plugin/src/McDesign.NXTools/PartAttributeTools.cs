using NXOpen;
using NXSDK;

namespace NXTools
{
    public static class PartAttributeTools
    {
        public static string GetString(string title)
        {
            var work = NXContext.WorkPart();
            try { return work.GetStringUserAttribute(title, 0); }
            catch { return string.Empty; }
        }

        public static void SetString(string title, string value)
        {
            var sess = NXContext.Session();
            var work = NXContext.WorkPart();

            NXObject[] objs = new NXObject[] { work };
            var b = sess.AttributeManager.CreateAttributePropertiesBuilder(
                work, objs, NXOpen.AttributePropertiesBuilder.OperationType.None
            );

            b.DataType = NXOpen.AttributePropertiesBaseBuilder.DataTypeOptions.String;
            b.Title = title;
            b.StringValue = value ?? string.Empty;

            try { b.Commit(); }
            finally { b.Destroy(); }
        }
    }
}
