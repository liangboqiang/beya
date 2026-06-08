using System;
using System.Windows.Forms;

namespace NXServer
{
    public static class Dispatcher
    {
        private static WindowsFormsSynchronizationContext _mainContext;

        public static void Initialize()
        {
            _mainContext = new WindowsFormsSynchronizationContext();
            System.Threading.SynchronizationContext.SetSynchronizationContext(_mainContext);
        }

        public static T Invoke<T>(Func<T> func)
        {
            if (_mainContext == null)
            {
                return func();
            }

            T NXResult = default(T);
            Exception exception = null;

            _mainContext.Send(_ =>
            {
                try
                {
                    NXResult = func();
                }
                catch (Exception ex)
                {
                    exception = ex;
                }
            }, null);

            if (exception != null)
            {
                throw exception;
            }

            return NXResult;
        }

        public static void Invoke(Action action)
        {
            Invoke<object>(() =>
            {
                action();
                return null;
            });
        }
    }
}