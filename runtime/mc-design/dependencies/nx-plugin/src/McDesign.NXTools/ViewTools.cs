using NXOpen;
using NXSDK;
using System;
using System.Collections.Generic;

namespace NXTools
{
    public class ViewSnapshot
    {
        public string Name { get; set; }

        public override string ToString()
        {
            return Name ?? "";
        }
    }

    public static class ViewTools
    {

        [Tool("FitView", "自动缩放视图以适应模型显示")]
        public static NXResult FitView()
        {
            try
            {
                FitViewImpl();
                return NXResult.Success("视图已自适应缩放");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "FitView 失败");
            }
        }

        [Tool("SetViewStyle", "设置 NX 视图显示模式")]
        public static NXResult SetViewStyle(int style_type)
        {
            try
            {
                SetViewStyleImpl(style_type);
                return NXResult.Success(new { style_type = style_type, style_name = StyleName(style_type) }, "视图样式已设置");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "设置视图样式失败");
            }
        }

        [Tool("GetViewStyle", "获取当前 NX 视图显示模式")]
        public static NXResult GetViewStyle()
        {
            try
            {
                int style = GetViewStyleImpl();
                return NXResult.Success(new { style_type = style, style_name = StyleName(style) }, $"当前视图模式：{StyleName(style)}");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "获取视图模式失败");
            }
        }

        [Tool("SwitchView", "切换 NX 视图")]
        public static NXResult SwitchView(string view_name)
        {
            try
            {
                Part part = NXContext.WorkPart();
                part.ModelingViews.WorkView.Orient(view_name, View.ScaleAdjustment.Saved);
                return NXResult.Success(null, $"视图切换成功,当前视图:{view_name}");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "视图切换失败");
            }
        }

        [Tool("GetAllViewNames", "获取全部视图名称")]
        public static NXResult GetAllViewNames()
        {
            try
            {
                Part part = NXContext.WorkPart();
                List<string> viewNames = new List<string>();
                foreach (ModelingView view in part.ModelingViews)
                {
                    viewNames.Add(view.Name);
                }

                var all_view_names = viewNames;
                return NXResult.Success(all_view_names, "获取全部视图名称成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "获取全部视图名称失败");
            }
        }

        [Tool("RotateAndScaleView", "旋转缩放 NX 视图")]
        public static NXResult RotateAndScaleView(double yawDeg, double pitchDeg, double rollDeg, double scaleRatio)
        {
            try
            {
                if (scaleRatio <= 0) return NXResult.Fail("scaleRatio 必须大于 0");

                var view = NXContext.WorkView();
                var rot = BuildEulerRotation(yawDeg, pitchDeg, rollDeg);
                var newMatrix = Multiply(view.Matrix, rot);
                var newScale = view.Scale * scaleRatio;

                view.SetRotationTranslationScale(newMatrix, view.Origin, newScale);
                NXContext.Update();

                return NXResult.Success(new { yaw_deg = yawDeg, pitch_deg = pitchDeg, roll_deg = rollDeg, scale_ratio = scaleRatio }, "视图旋转缩放完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "视图旋转缩放失败");
            }
        }



        // ---------------- public ----------------


        public static void FitViewImpl()
        {
            NXContext.WorkView().Fit();
        }

        public static void SetViewStyleImpl(int styleType)
        {
            NXContext.WorkView().RenderingStyle = (View.RenderingStyleType)styleType;
        }

        public static List<string> ListSnapshotNames()
        {
            Part part = NXContext.WorkPart();
            List<string> names = new List<string>();
            foreach (ModelingView view in part.ModelingViews)
            {
                if (view != null && !string.IsNullOrEmpty(view.Name))
                {
                    names.Add(view.Name);
                }
            }
            return names;
        }

        public static ViewSnapshot GetSnapshotByName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            foreach (string existing in ListSnapshotNames())
            {
                if (string.Equals(existing, name, StringComparison.OrdinalIgnoreCase))
                {
                    return new ViewSnapshot { Name = existing };
                }
            }
            return null;
        }

        public static void SaveSnapshotToAttr(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("view name is required", "name");
            NXContext.WorkPart();
        }

        public static void DeleteSnapshotByName(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("view name is required", "name");
            NXContext.WorkPart();
        }

        public static void SmoothSwitchToView(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("view name is required", "name");
            Part part = NXContext.WorkPart();
            part.ModelingViews.WorkView.Orient(name, View.ScaleAdjustment.Saved);
        }

        public static int GetViewStyleImpl()
        {
            return (int)NXContext.WorkView().RenderingStyle;
        }

        // ---------------- private ----------------

        private static string StyleName(int style)
        {
            switch (style)
            {
                case 0: return "ShadedWithEdges";
                case 1: return "ShadedWithBodyColorEdges";
                case 2: return "Shaded";
                case 3: return "WireframeWithDimEdges";
                case 4: return "WireframeWithHiddenEdges";
                case 5: return "WireframeWithDashedEdges";
                case 6: return "Studio";
                case 7: return "FaceAnalysis";
                case 8: return "PartiallyShaded";
                case 9: return "StaticWireframe";
                default: return "Unknown";
            }
        }

        private static Matrix3x3 BuildEulerRotation(double yawDeg, double pitchDeg, double rollDeg)
        {
            double yaw = DegToRad(yawDeg);
            double pitch = DegToRad(pitchDeg);
            double roll = DegToRad(rollDeg);

            var Ry = RotY(yaw);
            var Rx = RotX(pitch);
            var Rz = RotZ(roll);

            return Multiply(Multiply(Rz, Rx), Ry);
        }

        private static double DegToRad(double deg) => deg * Math.PI / 180.0;

        private static Matrix3x3 RotX(double a)
        {
            return new Matrix3x3
            {
                Xx = 1, Xy = 0, Xz = 0,
                Yx = 0, Yy = Math.Cos(a), Yz = -Math.Sin(a),
                Zx = 0, Zy = Math.Sin(a), Zz = Math.Cos(a)
            };
        }

        private static Matrix3x3 RotY(double a)
        {
            return new Matrix3x3
            {
                Xx = Math.Cos(a), Xy = 0, Xz = Math.Sin(a),
                Yx = 0, Yy = 1, Yz = 0,
                Zx = -Math.Sin(a), Zy = 0, Zz = Math.Cos(a)
            };
        }

        private static Matrix3x3 RotZ(double a)
        {
            return new Matrix3x3
            {
                Xx = Math.Cos(a), Xy = -Math.Sin(a), Xz = 0,
                Yx = Math.Sin(a), Yy = Math.Cos(a), Yz = 0,
                Zx = 0, Zy = 0, Zz = 1
            };
        }

        private static Matrix3x3 Multiply(Matrix3x3 a, Matrix3x3 b)
        {
            Matrix3x3 r = new Matrix3x3();

            r.Xx = a.Xx * b.Xx + a.Xy * b.Yx + a.Xz * b.Zx;
            r.Xy = a.Xx * b.Xy + a.Xy * b.Yy + a.Xz * b.Zy;
            r.Xz = a.Xx * b.Xz + a.Xy * b.Yz + a.Xz * b.Zz;

            r.Yx = a.Yx * b.Xx + a.Yy * b.Yx + a.Yz * b.Zx;
            r.Yy = a.Yx * b.Xy + a.Yy * b.Yy + a.Yz * b.Zy;
            r.Yz = a.Yx * b.Xz + a.Yy * b.Yz + a.Yz * b.Zz;

            r.Zx = a.Zx * b.Xx + a.Zy * b.Yx + a.Zz * b.Zx;
            r.Zy = a.Zx * b.Xy + a.Zy * b.Yy + a.Zz * b.Zy;
            r.Zz = a.Zx * b.Xz + a.Zy * b.Yz + a.Zz * b.Zz;

            return r;
        }
    }
}
