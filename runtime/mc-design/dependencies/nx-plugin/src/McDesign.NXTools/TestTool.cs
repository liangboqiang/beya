using NXOpen;
using NXOpen.GeometricUtilities;
using NXOpen.UF;
using NXSDK;
using System;
using System.Collections.Generic;
using System.Globalization;


namespace NXTools
{
    public class TestTool
    {
        [Tool("Test", "测试检查")]
        public static NXResult Test()
        {
            try
            {
                return NXResult.Success(new { passed = true }, "测试成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "测试失败");
            }



           
        }



  
    }

  
}
