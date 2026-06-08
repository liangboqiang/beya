using System;
using System.IO;
using System.Collections.Generic;
using NXSDK;

namespace NXTools
{
    /// <summary>
    /// NX 文件桥接工具：只提供文件系统能力，不涉及 docx 解析与写入
    /// </summary>
    public static class NxFileBridgeTools
    {
        [Tool("fs_read_bytes", "读取文件并返回字节（base64）")]
        public static NXResult FsReadBytes(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                    return NXResult.Fail("path 不能为空");
                if (!File.Exists(path))
                    return NXResult.Fail("文件不存在：" + path);

                byte[] bytes = File.ReadAllBytes(path);
                string b64 = Convert.ToBase64String(bytes);

                return NXResult.Success(new { path = path, base64 = b64 }, "读取成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "读取失败");
            }
        }

        [Tool("fs_write_bytes", "写入文件字节（base64），覆盖写")]
        public static NXResult FsWriteBytes(string path, string base64)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                    return NXResult.Fail("path 不能为空");
                if (string.IsNullOrWhiteSpace(base64))
                    return NXResult.Fail("base64 不能为空");

                string dir = Path.GetDirectoryName(path);
                if (string.IsNullOrWhiteSpace(dir))
                    return NXResult.Fail("path 非法：无法解析目录");

                Directory.CreateDirectory(dir);

                byte[] bytes = Convert.FromBase64String(base64);
                File.WriteAllBytes(path, bytes);

                return NXResult.Success(new { path = path, size = bytes.Length }, "写入成功");
            }
            catch (FormatException)
            {
                return NXResult.Fail("base64 格式不合法");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "写入失败");
            }
        }

        [Tool("fs_copy", "复制文件（可覆盖）")]
        public static NXResult FsCopy(string src_path, string dst_path, bool overwrite = true)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(src_path) || string.IsNullOrWhiteSpace(dst_path))
                    return NXResult.Fail("src_path/dst_path 不能为空");
                if (!File.Exists(src_path))
                    return NXResult.Fail("源文件不存在：" + src_path);

                string dir = Path.GetDirectoryName(dst_path);
                if (string.IsNullOrWhiteSpace(dir))
                    return NXResult.Fail("dst_path 非法：无法解析目录");
                Directory.CreateDirectory(dir);

                File.Copy(src_path, dst_path, overwrite);
                return NXResult.Success(new { src_path = src_path, dst_path = dst_path, overwrite = overwrite }, "复制成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "复制失败");
            }
        }

        [Tool("fs_exists", "检查文件是否存在")]
        public static NXResult FsExists(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                    return NXResult.Fail("path 不能为空");
                bool exists = File.Exists(path);
                return NXResult.Success(new { path = path, exists = exists }, "检查完成");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "检查失败");
            }
        }
    }
}
