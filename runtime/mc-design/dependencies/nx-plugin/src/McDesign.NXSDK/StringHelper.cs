using NXOpen;
using NXOpen.UF;
using System;

namespace NXSDK
{
    /// <summary>
    /// </summary>
    public static class StringHelper
    {
        public static string SafeTrim(string s)
        {
            return s == null ? string.Empty : s.Trim();
        }
    }
}
