using System;

namespace NXSDK
{
    [AttributeUsage(AttributeTargets.Method)]
    public class ToolAttribute : Attribute
    {
        public string Name { get; }
        public string Description { get; }
        public string Category { get; }

        public ToolAttribute(string name, string description = null)
        {
            Name = name;
            Description = description ?? string.Empty;
        }
    }
}