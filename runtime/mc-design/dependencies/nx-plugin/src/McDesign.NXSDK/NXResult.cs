using Newtonsoft.Json;
using System;

namespace NXSDK
{
    public class NXResult
    {
        [JsonProperty("ok")]
        public bool Ok { get; private set; }

        [JsonProperty("data")]
        public object Data { get; private set; }

        [JsonProperty("message")]
        public string Message { get; private set; }

        private NXResult(bool ok, object data, string message)
        {
            Ok = ok;
            Data = ok ? data : null;
            Message = string.IsNullOrWhiteSpace(message) ? (ok ? "执行成功" : "执行失败") : message;
        }

        public static NXResult Success(object data = null, string message = "执行成功")
            => new NXResult(true, data, message);

        public static NXResult Fail(string message)
            => new NXResult(false, null, message);

        public static NXResult FromException(Exception ex, string prefix = "异常")
            => Fail($"{prefix}：{ex.Message}");

        public string ToJson() => JsonConvert.SerializeObject(this);
    }
}
