// ===============================================================================
// File: Program.cs
// ===============================================================================

using System;
using System.Windows.Forms;

namespace AIWebForm
{
    public class Program
    {
        private static MainForm mainForm;

        public static void Main(string[] args)
        {
            try
            {
                ShowForm();
            }
            catch
            {
            }
        }

        public static void ShowForm()
        {
            if (mainForm != null && !mainForm.IsDisposed)
            {
                mainForm.NavigateConfiguredUrl();
                mainForm.Activate();
                return;
            }

            mainForm = new MainForm();
            mainForm.FormClosed += (sender, args) =>
            {
                mainForm = null;
            };
            mainForm.Show();
        }



        public static int GetUnloadOption(string arg)
        {
            return (int)NXOpen.Session.LibraryUnloadOption.Explicitly;
        }
    }
}
