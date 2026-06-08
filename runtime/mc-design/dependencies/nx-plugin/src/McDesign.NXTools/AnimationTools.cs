using NXOpen;
using NXSDK;
using System;

namespace NXTools
{
    public static class AnimationTools
    {
        [Tool("ExitAnimation", "退场动画")]
        public static NXResult ExitAnimation()
        {
            try
            {
                var view = NXContext.WorkView();

                // 尝试切换到“最佳视图”，无则继续
                var sw = ViewTools.SwitchView("最佳视图");
                if (!sw.Ok)
                    ViewTools.FitViewImpl();

                // 若不是 Shaded，则先切到 Shaded
                var style = ViewTools.GetViewStyleImpl();
                if (style != 0)
                    ViewTools.SetViewStyleImpl(0);

                ViewTools.FitViewImpl();

                OrbitScreenVertical(view, 360, 24);

                return NXResult.Success("退场动画完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "退场动画失败");
            }
        }

        // ---------------- private ----------------

        private static void OrbitScreenVertical(View view, double totalAngleDeg, int steps)
        {
            if (view == null) throw new ArgumentNullException(nameof(view));
            steps = Math.Max(1, steps);
            double stepDeg = totalAngleDeg / steps;

            for (int i = 0; i < steps; i++)
            {
                YawScreenVertical(view, stepDeg);
                NXContext.Update();
                System.Threading.Thread.Sleep(20);
            }
        }

        private static void YawScreenVertical(View view, double angleDeg)
        {
            double a = angleDeg * Math.PI / 180.0;

            var rot = new Matrix3x3
            {
                Xx = Math.Cos(a), Xy = 0, Xz = Math.Sin(a),
                Yx = 0,         Yy = 1, Yz = 0,
                Zx = -Math.Sin(a), Zy = 0, Zz = Math.Cos(a)
            };

            var m = view.Matrix;
            var newM = Multiply(m, rot);

            view.SetRotationTranslationScale(newM, view.Origin, view.Scale);
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
