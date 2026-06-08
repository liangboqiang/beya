using NXOpen;
using NXSDK;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using Builder = NXOpen.Optimization.OptimizationBuilder;

namespace NXTools
{
    /// <summary>
    /// NX Optimization 工具集。
    ///
    /// 设计取舍：
    /// 1) 不暴露“创建 Builder / 再多次设置 / 最后运行”的跨请求状态工具。
    ///    OptimizationBuilder 属于 NX 会话内临时 Builder，跨 HTTP/MCP 调用保存生命周期不稳定，
    ///    容易出现 Builder 泄漏、过期对象、用户并发互相污染等问题。
    /// 2) 暴露给智能体的原子能力是：查看使用说明、校验研究、创建/更新目标表达式。
    /// 3) 真正执行优化时使用 RunOptimizationStudy 一次性闭环：变量、目标、约束、算法、执行、结果回读都在一个 NX 主线程调用内完成。
    /// </summary>
    public static class OptimizationTools
    {
        public class OptimizerVariableItem
        {
            public string name { get; set; }
            public string lower { get; set; }
            public string upper { get; set; }
        }

        public class OptimizerObjectiveItem
        {
            public string name { get; set; }
            public string weight { get; set; }
            public string scale_factor { get; set; }
            public string objective_type { get; set; }
        }

        public class OptimizerConstraintItem
        {
            public string name { get; set; }
            public string constraint_type { get; set; }
            public string value { get; set; }
        }

        public class OptimizerAlgorithmOptions
        {
            public string algorithm_type { get; set; }
            public string absolute_convergence { get; set; }
            public string relative_convergence { get; set; }
            public string max_iteration { get; set; }
            public string time_limit { get; set; }
        }

        private const string DefaultObjectiveExpressionName = "Objective_AI";
        private const double NegativeInfinity = -1e308;
        private const double PositiveInfinity = 1e308;

        [Tool("GetOptimizationToolGuide", "Get NX optimization workflow guide and parameter schema")]
        public static NXResult GetOptimizationToolGuide()
        {
            try
            {
                var guide = new
                {
                    design = new
                    {
                        mode = "stateless_atomic_helpers_plus_one_shot_runner",
                        reason = "OptimizationBuilder 是 NX 会话内临时对象，不建议跨 MCP/HTTP 多轮调用保存 Builder 状态；智能体应先校验，再一次性运行优化研究。",
                        recommended_workflow = new[]
                        {
                            "1. 调用 GetDriveParamsList 或 GetAllParamsList 获取可优化表达式。",
                            "2. 选择变量 variables：每个变量必须是已存在表达式，且 lower < upper。",
                            "3. 选择目标 objectives：每个目标必须是已存在表达式；objective_type 支持 最小化/min/minimize、最大化/max/maximize、目标值数值。",
                            "4. 可选选择约束 constraints：constraint_type 支持 上限约束/upper/max/<=、下限约束/lower/min/>=。",
                            "5. 调用 ValidateOptimizationStudy 做预检。",
                            "6. 可选调用 BuildOptimizationObjectiveExpression 查看或写入 Objective_AI 目标表达式。",
                            "7. 调用 RunOptimizationStudy 执行。dry_run=true 时只校验与配置，不运行算法。"
                        }
                    },
                    tools = new[]
                    {
                        new { name = "ValidateOptimizationStudy", purpose = "只校验变量/目标/约束/算法和表达式存在性，不改变模型。" },
                        new { name = "BuildOptimizationObjectiveExpression", purpose = "根据多目标配置生成加权目标表达式，默认写入 Objective_AI。" },
                        new { name = "RunOptimizationStudy", purpose = "一次性创建优化研究、设置变量/目标/约束/算法并运行优化。" }
                    },
                    schemas = new
                    {
                        variable = new { name = "表达式名", lower = "下限数值字符串", upper = "上限数值字符串" },
                        objective = new { name = "表达式名", weight = "权重，可空默认1", scale_factor = "尺寸因子，可空默认1", objective_type = "最小化|最大化|数值目标" },
                        constraint = new { name = "表达式名", constraint_type = "上限约束|下限约束|upper|lower|<=|>=", value = "限值数值字符串" },
                        algorithm = new { algorithm_type = "可空，默认 GlobalSimplex；也支持 NX 枚举名或枚举整数", absolute_convergence = "默认1.0", relative_convergence = "默认0.001", max_iteration = "默认100", time_limit = "分钟，默认3" }
                    },
                    example_run_payload = new
                    {
                        title = "连杆轻量化优化",
                        variables = new[]
                        {
                            new { name = "L", lower = "50", upper = "70" },
                            new { name = "T", lower = "5", upper = "12" }
                        },
                        objectives = new[]
                        {
                            new { name = "Mass", weight = "1", scale_factor = "1", objective_type = "最小化" },
                            new { name = "Strength", weight = "0.2", scale_factor = "100", objective_type = "最大化" }
                        },
                        constraints = new[]
                        {
                            new { name = "Stress", constraint_type = "上限约束", value = "250" }
                        },
                        algorithm = new { algorithm_type = "GlobalSimplex", absolute_convergence = "1", relative_convergence = "0.001", max_iteration = "100", time_limit = "3" },
                        dry_run = false,
                        show_results = true
                    },
                    agent_notes = new[]
                    {
                        "不要猜表达式名；先调用 GetAllParamsList/GetDriveParamsList。",
                        "变量必须是可编辑、可驱动的表达式；目标/约束也必须能被 NX Optimization 识别。",
                        "多目标会被合成为 Objective_AI：最小化项为正，最大化项取负，数值目标项使用平方误差。",
                        "当需求含多个连续优化动作时，每次 RunOptimizationStudy 都是独立研究，避免在多轮对话中保存 Builder。"
                    }
                };

                return NXResult.Success(guide, "获取优化工具说明成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "获取优化工具说明失败");
            }
        }

        [Tool("ValidateOptimizationStudy", "Validate NX optimization variables, objectives, constraints, and algorithm without modifying the model")]
        public static NXResult ValidateOptimizationStudy(
            List<OptimizerVariableItem> variables,
            List<OptimizerObjectiveItem> objectives,
            List<OptimizerConstraintItem> constraints = null,
            OptimizerAlgorithmOptions algorithm = null)
        {
            try
            {
                var validation = ValidateInputs(variables, objectives, constraints, algorithm, requireObjectiveExpressionWrite: false);
                return NXResult.Success(validation, validation.ok ? "优化研究预检通过" : "优化研究预检未通过");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "优化研究预检失败");
            }
        }

        [Tool("BuildOptimizationObjectiveExpression", "Build or update the weighted NX optimization objective expression")]
        public static NXResult BuildOptimizationObjectiveExpression(
            List<OptimizerObjectiveItem> objectives,
            string expression_name = DefaultObjectiveExpressionName,
            bool write_to_part = true)
        {
            try
            {
                expression_name = NormalizeName(expression_name, DefaultObjectiveExpressionName);

                var validation = ValidateInputs(
                    new List<OptimizerVariableItem> { new OptimizerVariableItem { name = "__DUMMY__", lower = "0", upper = "1" } },
                    objectives,
                    null,
                    null,
                    requireVariables: false,
                    requireObjectiveExpressionWrite: write_to_part);

                if (!validation.ok)
                    return NXResult.Fail("目标表达式构建失败：" + string.Join("；", validation.errors));

                string formula = BuildObjectiveFormula(objectives, out List<object> terms);
                Expression expression = null;
                if (write_to_part)
                {
                    expression = CreateOrUpdateExpression(expression_name, formula);
                    NXContext.Update(false, "BuildOptimizationObjectiveExpression");
                }

                return NXResult.Success(new
                {
                    expression_name = expression_name,
                    formula = formula,
                    terms = terms,
                    written = write_to_part,
                    expression = expression == null ? null : ToExpressionSnapshot(expression)
                }, write_to_part ? "目标表达式已创建/更新" : "目标表达式公式已生成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "构建优化目标表达式失败");
            }
        }

        [Tool("RunOptimizationStudy", "Run a one-shot NX optimization study with variables, objectives, constraints, and algorithm")]
        public static NXResult RunOptimizationStudy(
            string title,
            List<OptimizerVariableItem> variables,
            List<OptimizerObjectiveItem> objectives,
            List<OptimizerConstraintItem> constraints = null,
            OptimizerAlgorithmOptions algorithm = null,
            bool dry_run = false,
            bool show_results = true)
        {
            Builder optimizer = null;
            DateTime startTime = DateTime.Now;

            try
            {
                title = NormalizeName(title, "AI_Optimization_Study");

                var validation = ValidateInputs(variables, objectives, constraints, algorithm, requireObjectiveExpressionWrite: true);
                if (!validation.ok)
                    return NXResult.Fail("优化研究参数无效：" + string.Join("；", validation.errors));

                var part = NXContext.WorkPart();
                optimizer = part.Optimization.CreateOptimizationBuilder();
                optimizer.IsUpdateDisp = true;
                optimizer.StudyName = title;

                optimizer.RemoveAllVariables();
                var variablePayload = ConfigureVariables(optimizer, variables);

                optimizer.RemoveAllObjectives();
                string objectiveFormula = BuildObjectiveFormula(objectives, out List<object> objectiveTerms);
                Expression objectiveExpression = CreateOrUpdateExpression(DefaultObjectiveExpressionName, objectiveFormula);
                var objectivePayload = ConfigureObjective(optimizer, objectiveExpression, objectiveFormula, objectiveTerms);

                optimizer.RemoveAllConstraints();
                var constraintPayload = ConfigureConstraints(optimizer, constraints);

                var algorithmPayload = ConfigureAlgorithm(optimizer, algorithm);

                var configured = new
                {
                    title = title,
                    dry_run = dry_run,
                    variables = variablePayload,
                    objective = objectivePayload,
                    constraints = constraintPayload,
                    algorithm = algorithmPayload
                };

                if (dry_run)
                {
                    DestroyBuilder(optimizer);
                    optimizer = null;
                    return NXResult.Success(configured, "优化研究 dry_run 配置成功，未运行算法");
                }

                optimizer.RunOptimization();
                DateTime endTime = DateTime.Now;

                if (show_results)
                {
                    TryCallNoArg(optimizer, "ShowResults");
                }

                NXContext.Update(false, "RunOptimizationStudy");

                var finalValues = ReadFinalValues(variables, objectives, constraints, objectiveExpression);
                var result = new
                {
                    title = title,
                    elapsed_seconds = Math.Round((endTime - startTime).TotalSeconds, 3),
                    completion_time = endTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                    configured = configured,
                    final_values = finalValues
                };

                DestroyBuilder(optimizer);
                optimizer = null;

                return NXResult.Success(result, "优化研究执行完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "优化研究执行失败");
            }
            finally
            {
                if (optimizer != null) DestroyBuilder(optimizer);
            }
        }

        private static dynamic ValidateInputs(
            List<OptimizerVariableItem> variables,
            List<OptimizerObjectiveItem> objectives,
            List<OptimizerConstraintItem> constraints,
            OptimizerAlgorithmOptions algorithm,
            bool requireVariables = true,
            bool requireObjectiveExpressionWrite = true)
        {
            var errors = new List<string>();
            var warnings = new List<string>();
            var variableChecks = new List<object>();
            var objectiveChecks = new List<object>();
            var constraintChecks = new List<object>();

            // 触发 WorkPart 检查，让错误尽早可见。
            var part = NXContext.WorkPart();

            if (requireVariables)
            {
                if (variables == null || variables.Count == 0)
                {
                    errors.Add("variables 不能为空");
                }
                else
                {
                    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var variable in variables)
                    {
                        string name = NormalizeName(variable == null ? null : variable.name, null);
                        double lower;
                        double upper;
                        bool lowerOk = TryParseDouble(variable == null ? null : variable.lower, out lower);
                        bool upperOk = TryParseDouble(variable == null ? null : variable.upper, out upper);
                        Expression exp = FindExpressionOrNull(name);
                        bool ok = true;

                        if (string.IsNullOrWhiteSpace(name)) { errors.Add("变量 name 不能为空"); ok = false; }
                        else if (!seen.Add(name)) { errors.Add("变量重复：" + name); ok = false; }
                        if (exp == null && !string.Equals(name, "__DUMMY__", StringComparison.Ordinal)) { errors.Add("变量表达式不存在：" + name); ok = false; }
                        if (!lowerOk) { errors.Add("变量 " + name + " 的 lower 不是有效数字"); ok = false; }
                        if (!upperOk) { errors.Add("变量 " + name + " 的 upper 不是有效数字"); ok = false; }
                        if (lowerOk && upperOk && lower >= upper) { errors.Add("变量 " + name + " 必须满足 lower < upper"); ok = false; }
                        if (exp != null && exp.IsNoEdit) warnings.Add("变量表达式不可编辑，NX Optimization 可能无法驱动：" + name);

                        variableChecks.Add(new
                        {
                            name = name,
                            exists = exp != null,
                            lower = lowerOk ? (double?)lower : null,
                            upper = upperOk ? (double?)upper : null,
                            is_editable = exp == null ? (bool?)null : !exp.IsNoEdit,
                            ok = ok
                        });
                    }
                }
            }

            if (objectives == null || objectives.Count == 0)
            {
                errors.Add("objectives 不能为空");
            }
            else
            {
                foreach (var objective in objectives)
                {
                    string name = NormalizeName(objective == null ? null : objective.name, null);
                    double weight = ParseDoubleOrDefault(objective == null ? null : objective.weight, 1.0);
                    double scale = ParseDoubleOrDefault(objective == null ? null : objective.scale_factor, 1.0);
                    ObjectiveMode mode = ParseObjectiveMode(objective == null ? null : objective.objective_type);
                    Expression exp = FindExpressionOrNull(name);
                    bool ok = true;

                    if (string.IsNullOrWhiteSpace(name)) { errors.Add("目标 name 不能为空"); ok = false; }
                    if (exp == null) { errors.Add("目标表达式不存在：" + name); ok = false; }
                    if (Math.Abs(weight) <= 1e-12) { warnings.Add("目标 " + name + " 权重为0，该目标不会影响优化"); }
                    if (Math.Abs(scale) <= 1e-12) { errors.Add("目标 " + name + " 的 scale_factor 不能为0"); ok = false; }
                    if (!mode.IsValid) { errors.Add("目标 " + name + " 的 objective_type 无法识别：" + (objective == null ? null : objective.objective_type)); ok = false; }

                    objectiveChecks.Add(new
                    {
                        name = name,
                        exists = exp != null,
                        weight = weight,
                        scale_factor = scale,
                        mode = mode.Kind,
                        target = mode.Target,
                        ok = ok
                    });
                }
            }

            if (constraints != null)
            {
                foreach (var constraint in constraints)
                {
                    string name = NormalizeName(constraint == null ? null : constraint.name, null);
                    double value;
                    bool valueOk = TryParseDouble(constraint == null ? null : constraint.value, out value);
                    ConstraintMode mode = ParseConstraintMode(constraint == null ? null : constraint.constraint_type);
                    Expression exp = FindExpressionOrNull(name);
                    bool ok = true;

                    if (string.IsNullOrWhiteSpace(name)) { errors.Add("约束 name 不能为空"); ok = false; }
                    if (exp == null) { errors.Add("约束表达式不存在：" + name); ok = false; }
                    if (!valueOk) { errors.Add("约束 " + name + " 的 value 不是有效数字"); ok = false; }
                    if (!mode.IsValid) { errors.Add("约束 " + name + " 的 constraint_type 无法识别：" + (constraint == null ? null : constraint.constraint_type)); ok = false; }

                    constraintChecks.Add(new
                    {
                        name = name,
                        exists = exp != null,
                        constraint_type = mode.Kind,
                        value = valueOk ? (double?)value : null,
                        ok = ok
                    });
                }
            }

            var algorithmCheck = ValidateAlgorithmOptions(algorithm);
            warnings.AddRange(algorithmCheck.warnings);

            if (requireObjectiveExpressionWrite)
            {
                Expression existedObjective = FindExpressionOrNull(DefaultObjectiveExpressionName);
                if (existedObjective != null && existedObjective.IsNoEdit)
                    errors.Add(DefaultObjectiveExpressionName + " 已存在但不可编辑，无法写入目标表达式");
            }

            return new
            {
                ok = errors.Count == 0,
                errors = errors,
                warnings = warnings,
                variables = variableChecks,
                objectives = objectiveChecks,
                constraints = constraintChecks,
                algorithm = algorithmCheck.summary,
                work_part = new
                {
                    name = part == null ? null : part.Name,
                    full_path = part == null ? null : part.FullPath
                }
            };
        }

        private static object ConfigureVariables(Builder optimizer, List<OptimizerVariableItem> variables)
        {
            int count = variables.Count;
            string[] names = new string[count];
            NXObject[] objects = new NXObject[count];
            Builder.OptimizationAttributeType[] types = new Builder.OptimizationAttributeType[count];
            double[] lowers = new double[count];
            double[] uppers = new double[count];
            var snapshot = new List<object>();

            for (int i = 0; i < count; i++)
            {
                var variable = variables[i];
                string name = NormalizeName(variable.name, null);
                double lower = ParseDoubleOrDefault(variable.lower, 0);
                double upper = ParseDoubleOrDefault(variable.upper, 0);
                Expression exp = FindExpressionOrThrow(name);

                names[i] = name;
                objects[i] = exp;
                types[i] = Builder.OptimizationAttributeType.Expression;
                lowers[i] = lower;
                uppers[i] = upper;

                snapshot.Add(new { name = name, lower = lower, upper = upper, expression = ToExpressionSnapshot(exp) });
            }

            optimizer.SetOptimizationVariables(names, objects, types, lowers, uppers);
            return snapshot;
        }

        private static object ConfigureObjective(Builder optimizer, Expression objectiveExpression, string formula, List<object> terms)
        {
            string[] names = { objectiveExpression.Name };
            NXObject[] objects = { objectiveExpression };
            Builder.OptimizationAttributeType[] types = { Builder.OptimizationAttributeType.Expression };
            double[] targets = { 0.0 };

            optimizer.SetOptimizationObjectives(names, objects, types, targets);
            optimizer.OptimizationType = Builder.OptimizationTargetType.Minimum;

            return new
            {
                expression_name = objectiveExpression.Name,
                formula = formula,
                optimization_type = optimizer.OptimizationType.ToString(),
                terms = terms,
                expression = ToExpressionSnapshot(objectiveExpression)
            };
        }

        private static object ConfigureConstraints(Builder optimizer, List<OptimizerConstraintItem> constraints)
        {
            var snapshot = new List<object>();
            if (constraints == null || constraints.Count == 0)
                return snapshot;

            var names = new List<string>();
            var objects = new List<NXObject>();
            var types = new List<Builder.OptimizationAttributeType>();
            var lowers = new List<double>();
            var uppers = new List<double>();
            var limitTypes = new List<Builder.OptimizationConstraintLimitType>();

            foreach (var constraint in constraints)
            {
                string name = NormalizeName(constraint.name, null);
                double value = ParseDoubleOrDefault(constraint.value, 0);
                ConstraintMode mode = ParseConstraintMode(constraint.constraint_type);
                Expression exp = FindExpressionOrThrow(name);

                names.Add(name);
                objects.Add(exp);
                types.Add(Builder.OptimizationAttributeType.Expression);

                if (mode.Kind == "upper")
                {
                    lowers.Add(NegativeInfinity);
                    uppers.Add(value);
                    limitTypes.Add(Builder.OptimizationConstraintLimitType.Upper);
                }
                else
                {
                    lowers.Add(value);
                    uppers.Add(PositiveInfinity);
                    limitTypes.Add(Builder.OptimizationConstraintLimitType.Lower);
                }

                snapshot.Add(new { name = name, constraint_type = mode.Kind, value = value, expression = ToExpressionSnapshot(exp) });
            }

            optimizer.SetOptimizationConstraints(
                names.ToArray(),
                objects.ToArray(),
                types.ToArray(),
                lowers.ToArray(),
                uppers.ToArray(),
                limitTypes.ToArray());

            return snapshot;
        }

        private static object ConfigureAlgorithm(Builder optimizer, OptimizerAlgorithmOptions algorithm)
        {
            string algorithmTypeRaw = algorithm == null ? null : algorithm.algorithm_type;
            Builder.OptimizationAlgorithmType algorithmType = ParseAlgorithmType(algorithmTypeRaw, Builder.OptimizationAlgorithmType.GlobalSimplex);
            optimizer.AlgorithmType = algorithmType;

            optimizer.AbsoluteConvergenceCriteria = ParseDoubleOrDefault(algorithm == null ? null : algorithm.absolute_convergence, 1.0);
            optimizer.RelativeConvergenceCriteria = ParseDoubleOrDefault(algorithm == null ? null : algorithm.relative_convergence, 0.001);
            optimizer.MaxNumberIteration = ParseIntOrDefault(algorithm == null ? null : algorithm.max_iteration, 100);
            optimizer.MaxTime = ParseIntOrDefault(algorithm == null ? null : algorithm.time_limit, 3);
            optimizer.IsUpdateDisp = true;

            return new
            {
                algorithm_type = optimizer.AlgorithmType.ToString(),
                absolute_convergence = optimizer.AbsoluteConvergenceCriteria,
                relative_convergence = optimizer.RelativeConvergenceCriteria,
                max_iteration = optimizer.MaxNumberIteration,
                time_limit = optimizer.MaxTime,
                update_display = optimizer.IsUpdateDisp
            };
        }

        private static dynamic ValidateAlgorithmOptions(OptimizerAlgorithmOptions algorithm)
        {
            var warnings = new List<string>();
            string raw = algorithm == null ? null : algorithm.algorithm_type;
            Builder.OptimizationAlgorithmType parsed = ParseAlgorithmType(raw, Builder.OptimizationAlgorithmType.GlobalSimplex);

            double abs = ParseDoubleOrDefault(algorithm == null ? null : algorithm.absolute_convergence, 1.0);
            double rel = ParseDoubleOrDefault(algorithm == null ? null : algorithm.relative_convergence, 0.001);
            int maxIter = ParseIntOrDefault(algorithm == null ? null : algorithm.max_iteration, 100);
            int timeLimit = ParseIntOrDefault(algorithm == null ? null : algorithm.time_limit, 3);

            if (abs <= 0) warnings.Add("absolute_convergence 建议大于0");
            if (rel <= 0) warnings.Add("relative_convergence 建议大于0");
            if (maxIter <= 0) warnings.Add("max_iteration 建议大于0");
            if (timeLimit <= 0) warnings.Add("time_limit 建议大于0分钟");

            return new
            {
                warnings = warnings,
                summary = new
                {
                    algorithm_type = parsed.ToString(),
                    absolute_convergence = abs,
                    relative_convergence = rel,
                    max_iteration = maxIter,
                    time_limit = timeLimit
                }
            };
        }

        private static string BuildObjectiveFormula(List<OptimizerObjectiveItem> objectives, out List<object> terms)
        {
            terms = new List<object>();
            var sb = new StringBuilder();
            double totalWeight = 0.0;
            bool hasTerm = false;

            sb.Append("(");
            foreach (var objective in objectives)
            {
                string name = NormalizeName(objective.name, null);
                double weight = ParseDoubleOrDefault(objective.weight, 1.0);
                double scale = ParseDoubleOrDefault(objective.scale_factor, 1.0);
                if (Math.Abs(scale) <= 1e-12) scale = 1.0;
                ObjectiveMode mode = ParseObjectiveMode(objective.objective_type);

                string termFormula = BuildObjectiveTermFormula(name, weight, scale, mode, out string normalizedMode, out double coefficient);
                if (string.IsNullOrWhiteSpace(termFormula)) continue;

                if (hasTerm) sb.Append("+");
                sb.Append(termFormula);
                hasTerm = true;
                totalWeight += Math.Abs(weight);

                terms.Add(new
                {
                    name = name,
                    weight = weight,
                    scale_factor = scale,
                    objective_type = normalizedMode,
                    target = mode.Target,
                    coefficient = coefficient,
                    term = termFormula
                });
            }

            if (!hasTerm)
                throw new ArgumentException("未能构建任何有效目标项");

            double denominator = Math.Max(1.0, totalWeight);
            sb.Append(")/");
            sb.Append(ToInvariant(denominator));
            return sb.ToString();
        }

        private static string BuildObjectiveTermFormula(string name, double weight, double scale, ObjectiveMode mode, out string normalizedMode, out double coefficient)
        {
            coefficient = weight / scale;
            normalizedMode = mode.Kind;

            if (mode.Kind == "maximize")
                return ToInvariant(-coefficient) + "*" + name;

            if (mode.Kind == "target")
            {
                double c = weight / (scale * scale);
                coefficient = c;
                string target = ToInvariant(mode.Target.GetValueOrDefault(0));
                return ToInvariant(c) + "*(" + name + "-" + target + ")*(" + name + "-" + target + ")";
            }

            return ToInvariant(coefficient) + "*" + name;
        }

        private static Expression CreateOrUpdateExpression(string name, string formula)
        {
            var part = NXContext.WorkPart();
            Expression exp = FindExpressionOrNull(name);
            if (exp == null)
            {
                exp = part.Expressions.Create(name + "=" + formula);
            }
            else
            {
                if (exp.IsNoEdit)
                    throw new ArgumentException("表达式不可编辑：" + name);
                part.Expressions.Edit(exp, formula);
            }
            return exp;
        }

        private static object ReadFinalValues(
            List<OptimizerVariableItem> variables,
            List<OptimizerObjectiveItem> objectives,
            List<OptimizerConstraintItem> constraints,
            Expression objectiveExpression)
        {
            var values = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            AddExpressionValue(values, DefaultObjectiveExpressionName, objectiveExpression);

            if (variables != null)
            {
                foreach (var v in variables)
                    AddExpressionValue(values, NormalizeName(v == null ? null : v.name, null), FindExpressionOrNull(v == null ? null : v.name));
            }

            if (objectives != null)
            {
                foreach (var o in objectives)
                    AddExpressionValue(values, NormalizeName(o == null ? null : o.name, null), FindExpressionOrNull(o == null ? null : o.name));
            }

            if (constraints != null)
            {
                foreach (var c in constraints)
                    AddExpressionValue(values, NormalizeName(c == null ? null : c.name, null), FindExpressionOrNull(c == null ? null : c.name));
            }

            return values.Values.ToList();
        }

        private static void AddExpressionValue(Dictionary<string, object> values, string name, Expression exp)
        {
            if (string.IsNullOrWhiteSpace(name) || exp == null || values.ContainsKey(name)) return;
            values[name] = ToExpressionSnapshot(exp);
        }

        private static object ToExpressionSnapshot(Expression exp)
        {
            if (exp == null) return null;
            return new
            {
                name = exp.Name,
                equation = SafeReadString(exp, "Equation"),
                type = SafeReadString(exp, "Type"),
                unit = exp.Units == null ? null : exp.Units.Name,
                value = SafeReadDouble(exp, "Value"),
                is_editable = !exp.IsNoEdit
            };
        }

        private static string SafeReadString(object obj, string propName)
        {
            try
            {
                var p = obj.GetType().GetProperty(propName, BindingFlags.Instance | BindingFlags.Public);
                if (p == null) return null;
                var v = p.GetValue(obj, null);
                return v == null ? null : v.ToString();
            }
            catch { return null; }
        }

        private static double? SafeReadDouble(object obj, string propName)
        {
            try
            {
                var p = obj.GetType().GetProperty(propName, BindingFlags.Instance | BindingFlags.Public);
                if (p == null) return null;
                var v = p.GetValue(obj, null);
                if (v == null) return null;
                if (v is double) return (double)v;
                double d;
                return TryParseDouble(v.ToString(), out d) ? (double?)d : null;
            }
            catch { return null; }
        }

        private static Expression FindExpressionOrThrow(string name)
        {
            var exp = FindExpressionOrNull(name);
            if (exp == null) throw new ArgumentException("表达式不存在：" + name);
            return exp;
        }

        private static Expression FindExpressionOrNull(string name)
        {
            name = NormalizeName(name, null);
            if (string.IsNullOrWhiteSpace(name)) return null;
            try { return ExpressionTools.FindExpression(name); }
            catch { return null; }
        }

        private static void DestroyBuilder(Builder optimizer)
        {
            if (optimizer == null) return;
            try { optimizer.Destroy(); } catch { }
        }

        private static bool TryCallNoArg(object target, string methodName)
        {
            if (target == null || string.IsNullOrWhiteSpace(methodName)) return false;
            try
            {
                var m = target.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public, null, Type.EmptyTypes, null);
                if (m == null) return false;
                m.Invoke(target, null);
                return true;
            }
            catch { return false; }
        }

        private static string NormalizeName(string value, string fallback)
        {
            var s = value == null ? string.Empty : value.Trim();
            return s.Length == 0 ? fallback : s;
        }

        private static bool TryParseDouble(string raw, out double value)
        {
            value = 0;
            if (string.IsNullOrWhiteSpace(raw)) return false;
            var s = raw.Trim();
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out value)
                || double.TryParse(s, NumberStyles.Float, CultureInfo.CurrentCulture, out value);
        }

        private static double ParseDoubleOrDefault(string raw, double fallback)
        {
            double v;
            return TryParseDouble(raw, out v) ? v : fallback;
        }

        private static int ParseIntOrDefault(string raw, int fallback)
        {
            int v;
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            return int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : fallback;
        }

        private static string ToInvariant(double value)
        {
            return value.ToString("G17", CultureInfo.InvariantCulture);
        }

        private static ObjectiveMode ParseObjectiveMode(string raw)
        {
            var s = (raw ?? "").Trim();
            if (s.Length == 0)
                return new ObjectiveMode { IsValid = true, Kind = "minimize" };

            var lower = s.ToLowerInvariant();
            if (lower == "min" || lower.Contains("minimize") || s.Contains("最小") || s.Contains("降低"))
                return new ObjectiveMode { IsValid = true, Kind = "minimize" };

            if (lower == "max" || lower.Contains("maximize") || s.Contains("最大") || s.Contains("提高"))
                return new ObjectiveMode { IsValid = true, Kind = "maximize" };

            if (lower.StartsWith("target:") || lower.StartsWith("target="))
                s = s.Substring(s.IndexOfAny(new[] { ':', '=' }) + 1).Trim();
            if (s.StartsWith("目标值") || s.StartsWith("目标"))
                s = s.Replace("目标值", "").Replace("目标", "").Replace(":", "").Replace("=", "").Trim();

            double target;
            if (TryParseDouble(s, out target))
                return new ObjectiveMode { IsValid = true, Kind = "target", Target = target };

            return new ObjectiveMode { IsValid = false, Kind = "unknown" };
        }

        private static ConstraintMode ParseConstraintMode(string raw)
        {
            var s = (raw ?? "").Trim();
            var lower = s.ToLowerInvariant();
            if (lower == "upper" || lower == "max" || lower == "<= " || lower == "<=" || s.Contains("上限") || s.Contains("不大于") || s.Contains("小于"))
                return new ConstraintMode { IsValid = true, Kind = "upper" };
            if (lower == "lower" || lower == "min" || lower == ">= " || lower == ">=" || s.Contains("下限") || s.Contains("不小于") || s.Contains("大于"))
                return new ConstraintMode { IsValid = true, Kind = "lower" };
            return new ConstraintMode { IsValid = false, Kind = "unknown" };
        }

        private static Builder.OptimizationAlgorithmType ParseAlgorithmType(string raw, Builder.OptimizationAlgorithmType fallback)
        {
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            string s = raw.Trim();
            string lower = s.ToLowerInvariant().Replace(" ", "").Replace("_", "").Replace("-", "");

            if (lower.Contains("globalsimplex") || s.Contains("全局单纯形"))
                return Builder.OptimizationAlgorithmType.GlobalSimplex;

            int intValue;
            if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out intValue) &&
                Enum.IsDefined(typeof(Builder.OptimizationAlgorithmType), intValue))
                return (Builder.OptimizationAlgorithmType)intValue;

            try
            {
                return (Builder.OptimizationAlgorithmType)Enum.Parse(typeof(Builder.OptimizationAlgorithmType), s, true);
            }
            catch
            {
                return fallback;
            }
        }

        private struct ObjectiveMode
        {
            public bool IsValid;
            public string Kind;
            public double? Target;
        }

        private struct ConstraintMode
        {
            public bool IsValid;
            public string Kind;
        }
    }
}
