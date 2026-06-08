using NXOpen;
using NXOpen.UF;
using System;

namespace NXSDK
{
    /// <summary>
    /// NX 运行时上下文（NXSDK 提供，NXTools 复用）
    /// </summary>
    public static class NXContext
    {
        public static Session Session()
        {
            return NXOpen.Session.GetSession() ?? throw new ArgumentException("无法获取 NX Session");
        }

        public static Part WorkPart()
        {
            return Session().Parts?.Work ?? throw new ArgumentException("当前没有 Work Part"); ;
        }

        public static UFSession UF()
        {
            return UFSession.GetUFSession();
        }

        /// <summary>
        /// 当前工作视图（ModelingViews.WorkView）
        /// </summary>
        public static View WorkView()
        {
            var part = WorkPart();
            var v = part.ModelingViews.WorkView;
            if (v == null) throw new ArgumentException("无法获取 WorkView");
            return v;
        }

        public static void Update(bool is_visible = false, string mark = "视图更新")
        {
            var sess = NXContext.Session();
            var udo = sess.SetUndoMark(is_visible? NXOpen.Session.MarkVisibility.Visible:NXOpen.Session.MarkVisibility.Invisible, mark);
            sess.UpdateManager.DoUpdate(udo);
        }
    }
}
