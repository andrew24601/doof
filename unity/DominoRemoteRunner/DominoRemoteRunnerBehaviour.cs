using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using AOT;
using UnityEngine;

public class DominoRemoteRunnerBehaviour : MonoBehaviour
{
    [SerializeField]
    private ushort port = 4000;

    [SerializeField]
    private bool autoStart = true;

    public ushort Port
    {
        get => port;
        set => port = value;
    }

    public bool AutoStart
    {
        get => autoStart;
        set => autoStart = value;
    }

    public bool IsConnected => drr_is_connected();

    public event Action<string, string> DominoEvent;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void NativeEventCallbackSignature(string eventName, string payload);

    private static NativeEventCallbackSignature eventCallbackDelegate;

    private static readonly ConcurrentQueue<EventRecord> eventQueue = new();

    private struct EventRecord
    {
        public string Name;
        public string Payload;
    }

    [MonoPInvokeCallback(typeof(NativeEventCallbackSignature))]
    private static void HandleNativeEvent(string eventName, string payload)
    {
        eventQueue.Enqueue(new EventRecord
        {
            Name = eventName,
            Payload = payload
        });
    }

    private void Awake()
    {
        eventCallbackDelegate = HandleNativeEvent;
        drr_register_event_callback(eventCallbackDelegate);
    }

    private void OnEnable()
    {
        if (autoStart)
        {
            StartListener();
        }
    }

    private void OnDisable()
    {
        if (autoStart)
        {
            StopListener();
        }
    }

    private void OnDestroy()
    {
        if (eventCallbackDelegate != null)
        {
            drr_register_event_callback(null);
            eventCallbackDelegate = null;
        }

        while (eventQueue.TryDequeue(out _))
        {
            // discard
        }
    }

    public void StartListener()
    {
        if (!drr_start_listener(port))
        {
            Debug.LogWarning($"DominoRemoteRunner: listener already running on port {port}");
        }
    }

    public void StopListener()
    {
        drr_stop_listener();
    }

    public void EmitTestEvent(string message)
    {
        drr_emit_event("unity_test", message);
    }

    public void QueueDominoEvent(string eventName, string payload)
    {
        drr_queue_domino_event(eventName ?? string.Empty, payload ?? string.Empty);
    }

    private void Update()
    {
        while (eventQueue.TryDequeue(out var evt))
        {
            DominoEvent?.Invoke(evt.Name, evt.Payload);
        }
    }

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern bool drr_start_listener(ushort port);

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl)]
    private static extern void drr_stop_listener();

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl)]
    private static extern bool drr_is_connected();

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl)]
    private static extern void drr_register_event_callback(NativeEventCallbackSignature callback);

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern void drr_emit_event(string eventName, string payload);

    [DllImport("UnityDominoRemoteRunner", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private static extern void drr_queue_domino_event(string eventName, string payload);
}
