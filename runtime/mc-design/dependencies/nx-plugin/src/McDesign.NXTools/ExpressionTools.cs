using NXOpen;
using NXSDK;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using static NXSDK.NXContext;

namespace NXTools
{
    public static class ExpressionTools
    {
        public class ExpressionInfo
        {
            public string std_id { get; set; }
            public string equation { get; set; }
            public string type { get; set; }
            public string unit { get; set; }
            public bool is_editable { get; set; }
            public string group_name { get; set; }
        }

        public class ExpressionUpdateItem
        {
            public string std_id { get; set; }
            public object value { get; set; }
        }

        public const string DRIVER_GROUP_NAME = "驱动参数";

        // =========================
        // Tools（对外保持原能力）
        // =========================

        [Tool("GetAllParamsList", "获取全部表达式参数列表")]
        public static NXResult GetAllParamsList()
        {
            try
            {
                var list = WorkPart().Expressions.ToArray()
                    .Where(e => e != null)
                    .Select(ToInfo)
                    .ToList();

                return NXResult.Success(new { expressions = list }, "获取全部参数成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "获取全部参数失败");
            }
        }

        [Tool("GetDriveParamsList", "获取驱动参数表达式列表（基于 group_name 过滤：包含“驱动”或“driver”）")]
        public static NXResult GetDriveParamsList()
        {
            try
            {
                var part = NXContext.WorkPart();
                var list = part.Expressions.ToArray()
                    .Where(e => e != null)
                    .Select(ToInfo)
                    .Where(info =>
                    {
                        var g = info.group_name ?? "";
                        if (g.Length == 0) return false;
                        return g.Contains("驱动") || g.IndexOf("driver", StringComparison.OrdinalIgnoreCase) >= 0;
                    })
                    .ToList();

                return NXResult.Success(new { expressions = list }, "获取驱动参数成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "获取驱动参数失败");
            }
        }

        [Tool("FindParams", "按 std_id 查找表达式参数")]
        public static NXResult FindParams(string std_id)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(std_id))
                    return NXResult.Fail("std_id 不能为空");

                var exp = FindExpression(std_id);
                if (exp == null)
                    return NXResult.Fail($"未找到表达式：{std_id}");

                return NXResult.Success(new { expression = ToInfo(exp) }, "查找成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "查找参数失败");
            }
        }

        [Tool("CreateParam", "创建表达式参数（std_id=value）")]
        public static NXResult CreateParam(string std_id, string value)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(std_id))
                    return NXResult.Fail("std_id 不能为空");

                var part = NXContext.WorkPart();
                var existed = FindExpression(std_id);
                if (existed != null)
                    return NXResult.Fail($"表达式已存在：{std_id}");

                var rhs = NormalizeNumberString(value);
                var exp = part.Expressions.Create($"{std_id}={rhs}");

                return NXResult.Success(new { expression = ToInfo(exp) }, "创建成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "创建参数失败");
            }
        }

        [Tool("UpdateParam", "更新表达式参数值（按 std_id 定位）")]
        public static NXResult UpdateParam(string std_id, string value)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(std_id))
                    return NXResult.Fail("std_id 不能为空");

                var part = NXContext.WorkPart();
                var exp = FindExpression(std_id);
                if (exp == null)
                    return NXResult.Fail($"未找到表达式：{std_id}");

                if (exp.IsNoEdit)
                    return NXResult.Fail($"表达式不可编辑：{std_id}");

                var rhs = NormalizeNumberString(value);
                part.Expressions.Edit(exp, rhs);
                NXContext.Update();

                return NXResult.Success(new { expression = ToInfo(exp) }, "更新成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "更新参数失败");
            }
        }

        [Tool("HighLightDim", "高亮表达式对应尺寸")]
        public static NXResult HighLightDim(string expName,bool isHighAssoOBjI)
        {
            var allDim =NXOpen.Session.GetSession().Parts.Work.Dimensions.ToArray().ToList().FindAll(q => q.AnnotationOrigin.Z > 0);
            var targetDim = allDim.Find(q => q.HasUserAttribute("尺寸标识", NXObject.AttributeType.String, -1) && q.GetUserAttributeAsString("尺寸标识", NXObject.AttributeType.String, -1) == expName);
            if (targetDim == null) { NXResult.Fail("未获取到对应的尺寸对象"); }
            targetDim.Highlight();
            if (isHighAssoOBjI)
            {
                List<NXObject> allAssoObjList = new List<NXObject>();
                for (int i = 1; i <= targetDim.NumberOfAssociativities; i++)
                {
                    allAssoObjList.Add(targetDim.GetAssociativity(i).FirstObject);
                    if (targetDim.GetAssociativity(i).SecondObject != null)
                        allAssoObjList.Add(targetDim.GetAssociativity(i).SecondObject);
                }
                allAssoObjList.ForEach(q => ((DisplayableObject)q).Highlight());
            }
            return NXResult.Success("目标尺寸已经高亮");
        }

        [Tool("BatchUpdateParams", "批量更新表达式参数值（每项包含 std_id/value）")]
        public static NXResult BatchUpdateParams(List<ExpressionUpdateItem> expressions)
        {
            try
            {
                if (expressions == null || expressions.Count == 0)
                    return NXResult.Fail("items 不能为空");

                var part = NXContext.WorkPart();
                var updated = new List<object>();
                var failed = new List<object>();

                foreach (var it in expressions)
                {
                    if (it == null || string.IsNullOrWhiteSpace(it.std_id))
                    {
                        failed.Add(new { std_id = it?.std_id, reason = "std_id 为空" });
                        continue;
                    }

                    try
                    {
                        var exp = FindExpression(it.std_id);
                        if (exp == null)
                        {
                            failed.Add(new { std_id = it.std_id, reason = "未找到表达式" });
                            continue;
                        }
                        if (exp.IsNoEdit)
                        {
                            failed.Add(new { std_id = it.std_id, reason = "表达式不可编辑" });
                            continue;
                        }

                        var rhs = NormalizeNumberString(Convert.ToString(it.value, CultureInfo.InvariantCulture));
                        part.Expressions.Edit(exp, rhs);
                        updated.Add(new { std_id = it.std_id, value = rhs });
                    }
                    catch (Exception e)
                    {
                        failed.Add(new { std_id = it.std_id, reason = e.Message });
                    }
                }

                NXContext.Update();
                return NXResult.Success(new { updated = updated, failed = failed }, "批量更新完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "批量更新失败");
            }
        }

        // ============================================================
        // EnsureExpression（重载 + range 校验 + 单位自动降级）
        // ============================================================

        public static Expression EnsureExpression(
            string stdId,
            double? newValue,
            bool isCreate,
            double defaultForCreate,
            double? fallbackForUpdate = null,
            string unit = "MilliMeter",
            string groupName = DRIVER_GROUP_NAME,
            double? minInclusive = null,
            double? maxInclusive = null)
        {
            if (string.IsNullOrWhiteSpace(stdId)) throw new ArgumentException("stdId 不能为空");

            double? v = ValidateNullable(newValue, minInclusive, maxInclusive);

            Part part = WorkPart();
            Expression exp = FindExpression(stdId);

            bool shouldWrite = v.HasValue || isCreate || (exp == null);
            double rhsVal = v.HasValue ? v.Value
                        : (isCreate ? defaultForCreate : (fallbackForUpdate ?? defaultForCreate));

            Unit u = TryFindUnit(part, unit);
            string rhs = ToInvariant(rhsVal);

            if (exp == null)
            {
                exp = (u != null)
                    ? part.Expressions.CreateWithUnits($"{stdId}={rhs}", u)
                    : part.Expressions.Create($"{stdId}={rhs}");
            }
            else if (shouldWrite)
            {
                if (exp.IsNoEdit)
                    throw new InvalidOperationException($"表达式不可编辑：{stdId}");

                if (u != null) part.Expressions.EditWithUnits(exp, u, rhs);
                else part.Expressions.Edit(exp, rhs);
            }

            TryMoveExpressionToGroup(exp, groupName);
            return exp;
        }

        public static Expression EnsureExpression(
            string stdId,
            int? newValue,
            bool isCreate,
            int defaultForCreate,
            int? fallbackForUpdate = null,
            string unit = "Unitless",
            string groupName = DRIVER_GROUP_NAME,
            int? minInclusive = null,
            int? maxInclusive = null)
        {
            if (string.IsNullOrWhiteSpace(stdId)) throw new ArgumentException("stdId 不能为空");

            int? v = ValidateNullable(newValue, minInclusive, maxInclusive);

            Part part = WorkPart();
            Expression exp = FindExpression(stdId);

            bool shouldWrite = v.HasValue || isCreate || (exp == null);
            int rhsVal = v.HasValue ? v.Value
                      : (isCreate ? defaultForCreate : (fallbackForUpdate ?? defaultForCreate));

            Unit u = TryFindUnit(part, unit);
            string rhs = rhsVal.ToString(CultureInfo.InvariantCulture);

            if (exp == null)
            {
                exp = (u != null)
                    ? part.Expressions.CreateWithUnits($"{stdId}={rhs}", u)
                    : part.Expressions.Create($"{stdId}={rhs}");
            }
            else if (shouldWrite)
            {
                if (exp.IsNoEdit)
                    throw new InvalidOperationException($"表达式不可编辑：{stdId}");

                if (u != null) part.Expressions.EditWithUnits(exp, u, rhs);
                else part.Expressions.Edit(exp, rhs);
            }

            TryMoveExpressionToGroup(exp, groupName);
            return exp;
        }

        // =========================
        // Validation helpers
        // =========================

        private static double? ValidateNullable(double? v, double? minInclusive, double? maxInclusive)
        {
            if (!v.HasValue) return null;
            double x = v.Value;
            if (double.IsNaN(x) || double.IsInfinity(x)) return null;
            if (minInclusive.HasValue && x < minInclusive.Value) return null;
            if (maxInclusive.HasValue && x > maxInclusive.Value) return null;
            return x;
        }

        private static int? ValidateNullable(int? v, int? minInclusive, int? maxInclusive)
        {
            if (!v.HasValue) return null;
            int x = v.Value;
            if (minInclusive.HasValue && x < minInclusive.Value) return null;
            if (maxInclusive.HasValue && x > maxInclusive.Value) return null;
            return x;
        }

        private static Unit TryFindUnit(Part part, string unitName)
        {
            if (part == null) return null;
            if (string.IsNullOrWhiteSpace(unitName)) return null;
            try
            {
                return part.UnitCollection.FindObject(unitName) as Unit;
            }
            catch
            {
                return null;
            }
        }

        // =========================
        // helper（保持你现有公共方法）
        // =========================

        public static Expression FindExpression(string stdId)
        {
            Part part = WorkPart();
            if (string.IsNullOrWhiteSpace(stdId)) throw new ArgumentException("stdId 不能为空");

            foreach (var e in part.Expressions.ToArray())
            {
                if (e != null && string.Equals(e.Name, stdId, StringComparison.Ordinal))
                    return e;
            }
            return null;
        }

        public static Expression SafeRenameExpression(Expression expr, string stdId)
        {
            if (expr != null && !string.Equals(expr.Name, stdId, StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(stdId))
                expr.SetName(stdId);
            return expr;
        }

        public static string NormalizeNumberString(string raw)
        {
            if (raw == null) return "0";
            var s = raw.Trim();
            if (s.Length == 0) return "0";

            bool hasLetter = s.Any(ch => char.IsLetter(ch) || ch == '_');
            if (hasLetter) return s;

            double d;
            if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d) ||
                double.TryParse(s, NumberStyles.Float, CultureInfo.CurrentCulture, out d))
            {
                return d.ToString("G17", CultureInfo.InvariantCulture);
            }
            return s;
        }

        public static string ToInvariant(double v)
        {
            return v.ToString("G17", CultureInfo.InvariantCulture);
        }

        public static string GetGroupName(Expression exp)
        {
            if (exp == null) return string.Empty;
            try
            {
                var part = NXContext.WorkPart();
                var g = part.ExpressionGroups.GetGroupOfExpression(exp);
                return g != null ? (g.Name ?? string.Empty) : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        // =========================
        // group（尽力放入“驱动参数”组，不成功也不影响流程）
        // =========================

        private static void TryMoveExpressionToGroup(Expression exp, string groupName)
        {
            if (exp == null || string.IsNullOrWhiteSpace(groupName)) return;

            try
            {
                var part = WorkPart();

                try
                {
                    var current = part.ExpressionGroups.GetGroupOfExpression(exp);
                    if (current != null && string.Equals(current.Name, groupName, StringComparison.Ordinal))
                        return;
                }
                catch { }

                object targetGroup = EnsureGroup(part, groupName);
                if (targetGroup == null) return;

                if (InvokeAddExpression(targetGroup, exp)) return;

                var eg = part.ExpressionGroups;
                var m = eg.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public)
                    .FirstOrDefault(mi =>
                    {
                        if (!string.Equals(mi.Name, "AddExpressionToGroup", StringComparison.OrdinalIgnoreCase)) return false;
                        var ps = mi.GetParameters();
                        return ps.Length == 2 && ps[1].ParameterType == typeof(Expression);
                    });
                if (m != null)
                {
                    m.Invoke(eg, new object[] { targetGroup, exp });
                    return;
                }

                TrySetExpressionGroupProperty(exp, targetGroup);
            }
            catch
            {
                // ignore
            }
        }

        private static object EnsureGroup(Part part, string groupName)
        {
            if (part == null || string.IsNullOrWhiteSpace(groupName)) return null;

            try { return part.ExpressionGroups.FindObject(groupName); }
            catch { }

            var eg = part.ExpressionGroups;
            var methods = eg.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public);

            var create = methods.FirstOrDefault(mi =>
            {
                if (!(string.Equals(mi.Name, "CreateGroup", StringComparison.OrdinalIgnoreCase) ||
                      string.Equals(mi.Name, "Create", StringComparison.OrdinalIgnoreCase)))
                    return false;

                var ps = mi.GetParameters();
                return ps.Length == 1 && ps[0].ParameterType == typeof(string);
            });

            if (create != null)
            {
                try { return create.Invoke(eg, new object[] { groupName }); }
                catch { }
            }

            return null;
        }

        private static bool InvokeAddExpression(object groupObj, Expression exp)
        {
            if (groupObj == null || exp == null) return false;

            try
            {
                var m = groupObj.GetType().GetMethods(BindingFlags.Instance | BindingFlags.Public)
                    .FirstOrDefault(mi =>
                    {
                        if (!string.Equals(mi.Name, "AddExpression", StringComparison.OrdinalIgnoreCase) &&
                            !string.Equals(mi.Name, "Add", StringComparison.OrdinalIgnoreCase))
                            return false;

                        var ps = mi.GetParameters();
                        return ps.Length == 1 && ps[0].ParameterType == typeof(Expression);
                    });

                if (m == null) return false;

                m.Invoke(groupObj, new object[] { exp });
                return true;
            }
            catch { return false; }
        }

        private static void TrySetExpressionGroupProperty(Expression exp, object groupObj)
        {
            if (exp == null || groupObj == null) return;

            try
            {
                var prop = exp.GetType().GetProperty("Group", BindingFlags.Instance | BindingFlags.Public);
                if (prop == null || !prop.CanWrite) return;
                if (!prop.PropertyType.IsInstanceOfType(groupObj)) return;
                prop.SetValue(exp, groupObj, null);
            }
            catch { }
        }

        // =========================
        // Info
        // =========================

        private static ExpressionInfo ToInfo(Expression exp)
        {
            return new ExpressionInfo
            {
                std_id = exp.Name,
                equation = exp.Equation,
                type = exp.Type,
                unit = exp.Units?.Name,
                is_editable = !exp.IsNoEdit,
                group_name = exp.OwningPart.ExpressionGroups.GetGroupOfExpression(exp).Name,
        };
        }
    }
}
