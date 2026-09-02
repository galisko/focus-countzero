'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Bell, Check, ChevronRight, Eye, EyeOff, FileText, ImagePlus, Info, ListChecks, ListTodo, PanelRightClose, PanelRightOpen, Pause, Play, Plus, RotateCcw, Settings2, SkipForward, Timer, TimerReset, Trash2, Volume2, VolumeX, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { clearAll, clearStore, getAll, getBackground, put, remove, type Session, type Subtask, type Task, type TaskStatus } from '@/lib/storage';

type Mode = 'focus' | 'short' | 'long';
type Settings = { focus: number; short: number; long: number; notifications: boolean; autoStart: boolean; volume: number; backgroundBlur: number; backgroundBrightness: number };
type TimerSnapshot = { mode: Mode; running: boolean; deadline: number | null; remaining: number };
type TaskTracking = { taskIds: string[]; subtaskKeys: string[]; startedAt: number; deadline: number };

const DEFAULTS: Settings = { focus: 25, short: 5, long: 15, notifications: true, autoStart: false, volume: 38, backgroundBlur: 0, backgroundBrightness: 100 };
const SETTINGS_KEY = 'fp:settings';
const TIMER_KEY = 'fp:timer';
const TRACKING_KEY = 'fp:task-tracking';
const CLIENT_ID = Math.random().toString(36).slice(2);
const MUSIC_TRACKS = [
  ['Alex Morgan · Chill Vlog Beats', '/music/alex-morgan-lofi-chill-vlog-beats-573883.mp3'],
  ['Alex Morgan · Midnight Club', '/music/alex-morgan-lofi-midnight-club-568164.mp3'],
  ['Alex Morgan · Rainy Night Study', '/music/alex-morgan-lofi-study-rainy-night-568166.mp3'],
  ['Alex Morgan · Sunny Cafe', '/music/alex-morgan-lofi-sunny-cafe-568156.mp3'],
  ['Kulakovka · Lofi Relax', '/music/kulakovka-lofi-relax-570489.mp3'],
  ['PrettyJohn1 · Lofi Music', '/music/prettyjohn1-lofi-lofi-music-587176.mp3'],
  ['The Mountain · Lofi Beats', '/music/the_mountain-lofi-beats-567433.mp3'],
  ['The Mountain · Lofi Music', '/music/the_mountain-lofi-lofi-music-496553.mp3'],
] as const;

function formatTime(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatTaskTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}` : `${minutes}:${String(seconds).padStart(2,'0')}`;
}

async function optimizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d'); if (!context) { bitmap.close(); return file; }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), 'image/webp', .86));
}

function dayKey(time: number) { return new Date(time).toLocaleDateString('en-CA'); }
function taskStatus(task: Task): TaskStatus { return task.status || (task.done ? 'done' : 'in_progress'); }

export default function FocusApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [mode, setMode] = useState<Mode>('focus');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(DEFAULTS.focus * 60_000);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState('');
  const [panel, setPanel] = useState<'settings' | 'history' | 'tasks' | 'task-detail' | 'music' | 'about' | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [tasksPanelVisible, setTasksPanelVisible] = useState(true);
  const [taskTracking, setTaskTracking] = useState<TaskTracking | null>(null);
  const [ambient, setAmbient] = useState(false);
  const [musicTrack, setMusicTrack] = useState<number | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const audioRef = useRef<{ context: AudioContext; gain: GainNode; source: AudioBufferSourceNode } | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const completingRef = useRef(false);
  const modeRef = useRef(mode);
  const settingsRef = useRef(settings);
  const activeTaskRef = useRef(activeTaskId);
  const tasksRef = useRef(tasks);
  const trackingRef = useRef<TaskTracking | null>(null);

  const durationFor = useCallback((selected: Mode, config = settingsRef.current) => config[selected === 'focus' ? 'focus' : selected] * 60_000, []);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { activeTaskRef.current = activeTaskId; }, [activeTaskId]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  const broadcast = useCallback((kind: string, payload?: unknown) => {
    channelRef.current?.postMessage({ source: CLIENT_ID, kind, payload });
  }, []);

  const refreshData = useCallback(async () => {
    const [taskRows, sessionRows] = await Promise.all([getAll<Task>('tasks'), getAll<Session>('sessions')]);
    const sortedTasks = taskRows.sort((a, b) => a.createdAt - b.createdAt);
    tasksRef.current = sortedTasks; setTasks(sortedTasks);
    setSessions(sessionRows.sort((a, b) => b.completedAt - a.completedAt));
  }, []);

  const beginTaskTracking = useCallback((trackDeadline: number) => {
    const taskIds = tasksRef.current.filter(task => task.counterEnabled && task.trackFocus !== false && taskStatus(task) === 'in_progress' && !task.hidden).map(task => task.id);
    const subtaskKeys = tasksRef.current.flatMap(task => (task.subtasks || []).filter(subtask => subtask.counterEnabled && !subtask.done && task.trackFocus !== false && taskStatus(task) === 'in_progress' && !task.hidden).map(subtask => `${task.id}:${subtask.id}`));
    if (!taskIds.length && !subtaskKeys.length) return;
    const segment = { taskIds, subtaskKeys, startedAt: Date.now(), deadline: trackDeadline };
    trackingRef.current = segment; setTaskTracking(segment); localStorage.setItem(TRACKING_KEY, JSON.stringify(segment));
  }, []);

  const creditTaskTracking = useCallback(async (at = Date.now()) => {
    const segment = trackingRef.current; if (!segment) return;
    trackingRef.current = null; setTaskTracking(null); localStorage.removeItem(TRACKING_KEY);
    const delta = Math.max(0, Math.min(at, segment.deadline) - segment.startedAt); if (!delta) return;
    const updatedTasks = tasksRef.current.map(task => {
      const nextTask = segment.taskIds.includes(task.id) ? { ...task, trackedMs: (task.trackedMs || 0) + delta } : task;
      if (!segment.subtaskKeys.some(key => key.startsWith(`${task.id}:`))) return nextTask;
      return { ...nextTask, subtasks: (task.subtasks || []).map(subtask => segment.subtaskKeys.includes(`${task.id}:${subtask.id}`) ? { ...subtask, trackedMs: (subtask.trackedMs || 0) + delta } : subtask) };
    });
    tasksRef.current = updatedTasks; setTasks(updatedTasks);
    await Promise.all(updatedTasks.filter(task => segment.taskIds.includes(task.id) || segment.subtaskKeys.some(key => key.startsWith(`${task.id}:`))).map(task => put('tasks', task))); broadcast('data'); return updatedTasks;
  }, [broadcast]);

  const saveTimer = useCallback((snapshot: TimerSnapshot) => {
    localStorage.setItem(TIMER_KEY, JSON.stringify(snapshot));
    broadcast('timer', snapshot);
  }, [broadcast]);

  const notify = useCallback((title: string, body: string) => {
    if (settingsRef.current.notifications && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon.svg' });
  }, []);

  const completeSession = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    const completedMode = modeRef.current;
    const config = settingsRef.current;
    let focusCount = sessions.filter(s => s.mode === 'focus').length;
    if (completedMode === 'focus') {
      const runningIds = tasksRef.current.filter(task => task.counterEnabled && task.trackFocus !== false && taskStatus(task) === 'in_progress' && !task.hidden).map(task => task.id);
      if (runningIds.length) await creditTaskTracking(Date.now());
      const session: Session = { id: crypto.randomUUID(), mode: 'focus', duration: config.focus, completedAt: Date.now(), taskId: activeTaskRef.current && runningIds.includes(activeTaskRef.current) ? activeTaskRef.current : undefined };
      await put('sessions', session);
      focusCount += 1;
      await Promise.all(tasksRef.current.filter(task => runningIds.includes(task.id)).map(task => put('tasks', { ...task, completed: task.completed + 1 })));
      notify('Focus session complete', 'Protocol complete. Time to recover.');
    } else {
      const session: Session = { id: crypto.randomUUID(), mode: completedMode, duration: config[completedMode], completedAt: Date.now() };
      await put('sessions', session);
      notify('Break complete', 'Ready for another focus session?');
    }
    await refreshData();
    broadcast('data');
    const next: Mode = completedMode === 'focus' ? (focusCount % 4 === 0 ? 'long' : 'short') : 'focus';
    const nextRemaining = durationFor(next, config);
    setMode(next); setRunning(false); setDeadline(null); setRemaining(nextRemaining);
    saveTimer({ mode: next, running: false, deadline: null, remaining: nextRemaining });
    if (config.autoStart) {
      const nextDeadline = Date.now() + nextRemaining;
      setRunning(true); setDeadline(nextDeadline);
      workerRef.current?.postMessage({ type: 'start', deadline: nextDeadline });
      saveTimer({ mode: next, running: true, deadline: nextDeadline, remaining: nextRemaining });
      if (next === 'focus') beginTaskTracking(nextDeadline);
    }
    window.setTimeout(() => { completingRef.current = false; }, 600);
  }, [beginTaskTracking, broadcast, creditTaskTracking, durationFor, notify, refreshData, saveTimer, sessions]);

  useEffect(() => {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    const config = savedSettings ? { ...DEFAULTS, ...JSON.parse(savedSettings) } : DEFAULTS;
    setSettings(config); settingsRef.current = config;
    const savedTimer = localStorage.getItem(TIMER_KEY);
    if (savedTimer) {
      const timer = JSON.parse(savedTimer) as TimerSnapshot;
      const liveRemaining = timer.running && timer.deadline ? Math.max(0, timer.deadline - Date.now()) : timer.remaining;
      setMode(timer.mode); modeRef.current = timer.mode; setRunning(timer.running && liveRemaining > 0); setDeadline(timer.deadline); setRemaining(liveRemaining);
    } else setRemaining(config.focus * 60_000);
    setActiveTaskId(localStorage.getItem('fp:active-task'));
    setTasksPanelVisible(localStorage.getItem('fp:tasks-panel') !== 'hidden');
    const savedTracking = localStorage.getItem(TRACKING_KEY);
    if (savedTracking) { const raw = JSON.parse(savedTracking) as TaskTracking & { taskId?: string }; const segment: TaskTracking = { taskIds: raw.taskIds || (raw.taskId ? [raw.taskId] : []), subtaskKeys: raw.subtaskKeys || [], startedAt:raw.startedAt, deadline:raw.deadline }; trackingRef.current = segment; setTaskTracking(segment); }
    refreshData();
    getBackground().then(entry => { if (entry) setBackgroundUrl(URL.createObjectURL(entry.blob)); });
    const worker = new Worker('/timer-worker.js');
    workerRef.current = worker;
    const channel = new BroadcastChannel('focus-protocol-sync');
    channelRef.current = channel;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=3').then(registration => registration.update()).catch(() => undefined);
    setReady(true);
    return () => { worker.terminate(); channel.close(); if (backgroundUrl) URL.revokeObjectURL(backgroundUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !workerRef.current) return;
    workerRef.current.onmessage = ({ data }) => {
      if (data.type === 'tick') setRemaining(data.remaining);
      if (data.type === 'complete') completeSession();
    };
    if (running && deadline) workerRef.current.postMessage({ type: 'start', deadline });
  }, [completeSession, deadline, ready, running]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    channel.onmessage = ({ data }) => {
      if (data.source === CLIENT_ID) return;
      if (data.kind === 'data') refreshData();
      if (data.kind === 'settings') setSettings(data.payload as Settings);
      if (data.kind === 'timer') {
        const timer = data.payload as TimerSnapshot;
        setMode(timer.mode); setRunning(timer.running); setDeadline(timer.deadline);
        setRemaining(timer.running && timer.deadline ? Math.max(0, timer.deadline - Date.now()) : timer.remaining);
      }
    };
  }, [ready, refreshData]);

  useEffect(() => { document.title = `${formatTime(remaining)} · ${mode === 'focus' ? 'Focus' : 'Break'} | Focus Protocol`; }, [mode, remaining]);

  const switchMode = async (next: Mode) => {
    if (mode === 'focus') await creditTaskTracking();
    workerRef.current?.postMessage({ type: 'stop' });
    const nextRemaining = durationFor(next);
    setMode(next); setRunning(false); setDeadline(null); setRemaining(nextRemaining);
    saveTimer({ mode: next, running: false, deadline: null, remaining: nextRemaining });
  };

  const toggleTimer = async () => {
    if (running) {
      const paused = deadline ? Math.max(0, deadline - Date.now()) : remaining;
      if (mode === 'focus') await creditTaskTracking();
      workerRef.current?.postMessage({ type: 'stop' });
      setRunning(false); setDeadline(null); setRemaining(paused);
      saveTimer({ mode, running: false, deadline: null, remaining: paused });
    } else {
      const nextDeadline = Date.now() + remaining;
      setRunning(true); setDeadline(nextDeadline);
      workerRef.current?.postMessage({ type: 'start', deadline: nextDeadline });
      saveTimer({ mode, running: true, deadline: nextDeadline, remaining });
      if (mode === 'focus') beginTaskTracking(nextDeadline);
    }
  };

  const resetTimer = async () => {
    if (mode === 'focus') await creditTaskTracking();
    workerRef.current?.postMessage({ type: 'stop' });
    const reset = durationFor(mode);
    setRunning(false); setDeadline(null); setRemaining(reset);
    saveTimer({ mode, running: false, deadline: null, remaining: reset });
  };

  const resetCounting = async () => {
    const updated = tasksRef.current.map(task => ({ ...task, completed: 0, trackedMs: 0, subtasks: (task.subtasks || []).map(subtask => ({ ...subtask, trackedMs: 0 })) }));
    await clearStore('sessions'); await Promise.all(updated.map(task => put('tasks', task))); tasksRef.current = updated; setTasks(updated); setSessions([]); broadcast('data');
  };

  const resetEverything = async () => {
    if (!window.confirm('Reset all local tasks, sessions, settings, and background data?')) return;
    await creditTaskTracking(); workerRef.current?.postMessage({ type: 'stop' }); await clearAll();
    [SETTINGS_KEY, TIMER_KEY, TRACKING_KEY, 'fp:active-task', 'fp:tasks-panel'].forEach(key => localStorage.removeItem(key));
    setSettings(DEFAULTS); settingsRef.current = DEFAULTS; setMode('focus'); modeRef.current = 'focus'; setRunning(false); setDeadline(null); setRemaining(DEFAULTS.focus * 60_000);
    setTasks([]); setSessions([]); setActiveTaskId(null); activeTaskRef.current = null; setTaskTracking(null); trackingRef.current = null; setBackgroundUrl(null); setPanel('tasks');
    saveTimer({ mode:'focus', running:false, deadline:null, remaining:DEFAULTS.focus * 60_000 }); localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULTS)); broadcast('data'); broadcast('settings', DEFAULTS);
  };

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); settingsRef.current = next; localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); broadcast('settings', next);
    if (!running) { const nextRemaining = durationFor(mode, next); setRemaining(nextRemaining); saveTimer({ mode, running: false, deadline: null, remaining: nextRemaining }); }
  };

  const addTask = async () => {
    const title = taskDraft.trim(); if (!title) return;
    const task: Task = { id: crypto.randomUUID(), title, estimate: 4, completed: 0, done: false, createdAt: Date.now(), notes: '', subtasks: [], status: 'in_progress', hidden: false, trackFocus: true, trackedMs: 0, counterEnabled: false };
    await put('tasks', task); setTaskDraft(''); if (!activeTaskId) selectTask(task.id); await refreshData(); broadcast('data');
  };
  const selectTask = async (id: string) => { setActiveTaskId(id); activeTaskRef.current = id; localStorage.setItem('fp:active-task', id); };
  const toggleTask = async (task: Task) => { const nextStatus: TaskStatus = taskStatus(task) === 'done' ? 'in_progress' : 'done'; await updateTask({ ...task, status: nextStatus, done: nextStatus === 'done' }); };
  const updateTask = async (task: Task) => { const current = tasksRef.current.find(item => item.id === task.id); const subtaskTrackingChanged = JSON.stringify((current?.subtasks || []).map(item => [item.id, item.counterEnabled, item.done])) !== JSON.stringify((task.subtasks || []).map(item => [item.id, item.counterEnabled, item.done])); const affectsTracking = !!current && (current.counterEnabled !== task.counterEnabled || current.trackFocus !== task.trackFocus || taskStatus(current) !== taskStatus(task) || current.hidden !== task.hidden || subtaskTrackingChanged); const parentWasTracked = !!trackingRef.current?.taskIds.includes(task.id); const wasTracked = !!trackingRef.current && (parentWasTracked || trackingRef.current.subtaskKeys.some(key => key.startsWith(`${task.id}:`))); const credited = affectsTracking && trackingRef.current ? await creditTaskTracking() : undefined; const creditedTask = wasTracked ? credited?.find(item => item.id === task.id) : undefined; const nextTask = creditedTask ? { ...task, trackedMs:parentWasTracked ? creditedTask.trackedMs : task.trackedMs, subtasks:task.subtasks?.map(subtask => creditedTask.subtasks?.find(item => item.id === subtask.id) || subtask) } : task; await put('tasks', nextTask); if (task.id === activeTaskId && (taskStatus(task) !== 'in_progress' || task.hidden)) { setActiveTaskId(null); activeTaskRef.current = null; localStorage.removeItem('fp:active-task'); } await refreshData(); if (affectsTracking && running && deadline && modeRef.current === 'focus') beginTaskTracking(deadline); broadcast('data'); };
  const toggleTaskCounter = async (task: Task) => { await updateTask({ ...task, counterEnabled:!task.counterEnabled, trackFocus:true }); };
  const toggleSubtaskCounter = async (task: Task, subtask: Subtask) => { const subtasks = (task.subtasks || []).map(item => item.id === subtask.id ? { ...item, counterEnabled:!item.counterEnabled } : item); await updateTask({ ...task, subtasks }); };
  const openTaskDetail = (id: string) => { setDetailTaskId(id); setPanel('task-detail'); setTasksPanelVisible(true); localStorage.setItem('fp:tasks-panel', 'visible'); };
  const deleteTask = async (id: string) => { if (trackingRef.current?.taskIds.includes(id)) await creditTaskTracking(); await remove('tasks', id); if (activeTaskId === id) { setActiveTaskId(null); localStorage.removeItem('fp:active-task'); } if (detailTaskId === id) { setDetailTaskId(null); setPanel(null); } await refreshData(); if (running && deadline && modeRef.current === 'focus') beginTaskTracking(deadline); broadcast('data'); };

  const toggleAmbient = () => {
    if (audioRef.current) { audioRef.current.source.stop(); audioRef.current.context.close(); audioRef.current = null; setAmbient(false); return; }
    const context = new AudioContext(); const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate); const data = buffer.getChannelData(0);
    let last = 0; for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; last = (last + .02 * white) / 1.02; data[i] = last * 3.2; }
    const source = context.createBufferSource(); source.buffer = buffer; source.loop = true; const gain = context.createGain(); gain.gain.value = settings.volume / 450; source.connect(gain).connect(context.destination); source.start(); audioRef.current = { context, gain, source }; setAmbient(true);
  };
  const stopMusic = () => { musicRef.current?.pause(); if (musicRef.current) musicRef.current.currentTime = 0; setMusicPlaying(false); };
  const playMusic = (index: number) => { const player = musicRef.current || new Audio(); musicRef.current = player; player.src = MUSIC_TRACKS[index][1]; player.loop = true; player.volume = settings.volume / 100; player.play().catch(() => undefined); setMusicTrack(index); setMusicPlaying(true); };
  const nextMusic = () => playMusic(musicTrack === null ? 0 : (musicTrack + 1) % MUSIC_TRACKS.length);
  useEffect(() => { if (musicRef.current) musicRef.current.volume = settings.volume / 100; }, [settings.volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.gain.gain.value = settings.volume / 450; }, [settings.volume]);

  const uploadBackground = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const optimized = await optimizeImage(file);
    await put('backgrounds', { id: 'active', blob: optimized, name: file.name, updatedAt: Date.now() });
    if (backgroundUrl) URL.revokeObjectURL(backgroundUrl); setBackgroundUrl(URL.createObjectURL(optimized)); broadcast('background');
  };
  const clearBackground = async () => { await remove('backgrounds', 'active'); if (backgroundUrl) URL.revokeObjectURL(backgroundUrl); setBackgroundUrl(null); broadcast('background'); };

  const focusSessions = useMemo(() => sessions.filter(item => item.mode === 'focus'), [sessions]);
  const streak = useMemo(() => {
    const days = new Set(focusSessions.map(item => dayKey(item.completedAt))); let count = 0; const cursor = new Date();
    if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dayKey(cursor.getTime()))) { count++; cursor.setDate(cursor.getDate() - 1); } return count;
  }, [focusSessions]);
  const activeTask = tasks.find(item => item.id === activeTaskId);
  const completedInCycle = focusSessions.length % 4;
  const totalDuration = durationFor(mode);
  const progress = Math.min(1, Math.max(0, 1 - remaining / totalDuration));
  const liveTrackingMs = taskTracking ? Math.max(0, Math.min(Date.now(), taskTracking.deadline) - taskTracking.startedAt) : 0;
  const toggleTasksPanel = () => { const next = !tasksPanelVisible; setTasksPanelVisible(next); localStorage.setItem('fp:tasks-panel', next ? 'visible' : 'hidden'); if (!next) setPanel(null); };
  const openRail = (next: 'tasks' | 'settings' | 'music' | 'about') => { if (tasksPanelVisible && panel === next) { toggleTasksPanel(); return; } setTasksPanelVisible(true); localStorage.setItem('fp:tasks-panel', 'visible'); setPanel(next); };
  const railView = panel === 'settings' || panel === 'task-detail' || panel === 'music' || panel === 'about' ? panel : 'tasks';

  return (
    <main className={`app-shell mode-${mode}`}>
      {backgroundUrl && (
        <div className="background-layer" aria-hidden="true"><div className="background-image" style={{ backgroundImage:`url(${backgroundUrl})`, filter:`blur(${settings.backgroundBlur}px) brightness(${settings.backgroundBrightness}%)`, transform:`scale(${1.08 + settings.backgroundBlur / 180})` }}/></div>
      )}
      <header className="topbar">
        <a className="brand" href="#" aria-label="Focus Protocol home"><span className="brand-mark"><Zap size={15}/></span><span>FOCUS<span className="brand-dim">/PROTOCOL</span></span></a>
        <div className="system-status"><span/> {ready ? 'SYSTEM READY' : 'BOOTING'} · LOCAL ONLY</div>
        <div className="header-actions"><Button variant="ghost" size="icon" aria-label="Session history" className="icon-button mobile-history" onClick={() => setPanel('history')}><BarChart3/></Button><button aria-label="Open about" className={`about-toggle ${railView === 'about' && tasksPanelVisible ? 'selected' : ''}`} onClick={() => openRail('about')}><Info/><span>ABOUT</span></button><button aria-label="Open music" className={`icon-button music-toggle ${railView === 'music' && tasksPanelVisible ? 'selected' : ''}`} onClick={() => openRail('music')}><Volume2/><span className={musicPlaying ? 'music-bars active' : 'music-bars'}><i/><i/><i/></span></button><button aria-label="Open tasks" className={`topbar-show-tasks ${railView === 'tasks' && tasksPanelVisible ? 'selected' : ''}`} onClick={() => openRail('tasks')}><ListTodo/><span>SHOW TASKS</span></button><Button variant="ghost" size="icon" aria-label="Open settings" className={`icon-button topbar-toggle ${railView === 'settings' && tasksPanelVisible ? 'selected' : ''}`} onClick={() => openRail('settings')}><Settings2/></Button></div>
      </header>

      <section className={`workspace ${tasksPanelVisible ? '' : 'tasks-panel-hidden'}`}>
        <section className="timer-stage" aria-label="Pomodoro timer">
          <div className="mode-switch" aria-label="Timer mode">{(['focus','short','long'] as Mode[]).map(item => <button key={item} className={mode === item ? 'active' : ''} onClick={() => switchMode(item)}>{item === 'focus' ? 'FOCUS' : item === 'short' ? 'SHORT BREAK' : 'LONG BREAK'} <span className="mode-count">[{sessions.filter(session => session.mode === item).length}]</span></button>)}</div>
          <button className="active-task-mobile" onClick={() => setPanel('tasks')}><ListTodo size={13}/>{activeTask?.title || 'Select a task'}<ChevronRight size={13}/></button>
          <div className="timer-meta"><span>SESSION {String(focusSessions.length + 1).padStart(2,'0')}</span><span>{activeTask?.title?.toUpperCase() || (mode === 'focus' ? 'DEEP WORK' : 'RECOVERY')}</span></div>
          <div className={`timer-ring ${running ? 'is-running' : ''}`} style={{ '--progress': `${progress * 360}deg` } as React.CSSProperties}>
            <div className="progress-arc"/><div className="ring-grid"/><time className="timer-digits">{formatTime(remaining)}</time><span className="timer-unit">{running ? 'PROTOCOL ACTIVE' : 'MINUTES REMAINING'}</span>
          </div>
          <div className="timer-controls">
            <Button variant="outline" size="icon-lg" className="round-control" aria-label="Reset timer" onClick={resetTimer}><RotateCcw/></Button>
            <Button size="lg" className="start-button" onClick={toggleTimer}>{running ? <><Pause fill="currentColor"/> PAUSE PROTOCOL</> : <><Play fill="currentColor"/> INITIATE {mode === 'focus' ? 'FOCUS' : 'BREAK'}</>}</Button>
            <Button variant="outline" size="icon-lg" className={`round-control ${ambient ? 'sound-on' : ''}`} aria-label="Toggle ambient sound" onClick={toggleAmbient}>{ambient ? <Volume2/> : <VolumeX/>}</Button>
          </div>
          <button className="reset-counting" onClick={resetCounting}><span>$ counter.reset</span> RESET COUNTING</button>
          <div className="progress-dots" aria-label={`${completedInCycle} of 4 focus sessions complete`}>{[0,1,2,3].map(i => <i key={i} className={i < completedInCycle ? 'filled' : ''}/>)}</div>
        </section>

        <aside className="side-panel task-panel" aria-label={railView === 'settings' ? 'Settings' : 'Tasks'}>
          <div className="panel-heading">{railView === 'task-detail' ? <Button variant="ghost" size="sm" className="drawer-back" onClick={() => setPanel('tasks')}><ChevronRight className="back-icon"/> BACK TO TASKS</Button> : <div className="panel-label"><span>{railView === 'settings' ? '02' : '01'}</span> {railView === 'settings' ? 'SYSTEM CONFIG' : <>TASK CONTROL <em>{tasks.filter(t => taskStatus(t) === 'in_progress' && !t.hidden).length}</em></>}</div>}<Button variant="ghost" size="icon-sm" aria-label="Hide side panel" className="panel-inline-toggle" onClick={toggleTasksPanel}><PanelRightClose/></Button></div>
          {railView === 'settings' && (
            <SettingsPanel settings={settings} update={updateSettings} ambient={ambient} toggleAmbient={toggleAmbient} uploadBackground={uploadBackground} clearBackground={clearBackground} hasBackground={!!backgroundUrl} onReset={resetEverything}/>
          )}
          <div className={`music-view ${railView === 'music' ? '' : 'is-hidden'}`} aria-hidden={railView !== 'music'}><MusicPanel musicTrack={musicTrack} musicPlaying={musicPlaying} playMusic={playMusic} nextMusic={nextMusic} stopMusic={stopMusic}/></div>
          {railView === 'about' && <AboutPanel/>}
          {railView === 'tasks' && <><TaskList tasks={tasks} activeTaskId={activeTaskId} trackingTaskIds={taskTracking?.taskIds || []} liveTrackingMs={liveTrackingMs} activeSessionDurationMs={mode === 'focus' ? totalDuration : settings.focus * 60_000} onDetail={openTaskDetail} onCounter={toggleTaskCounter} onToggle={toggleTask} onDelete={deleteTask}/><form className="task-entry" onSubmit={event => { event.preventDefault(); addTask(); }}><input value={taskDraft} onChange={event => setTaskDraft(event.target.value)} placeholder="Add a focus task…" aria-label="New task"/><button aria-label="Add task"><Plus size={14}/></button></form><div className="terminal-note"><span>$ privacy.status</span><p>IndexedDB active. All records remain on this device.</p></div></>}
          {railView === 'task-detail' && detailTaskId && tasks.find(task => task.id === detailTaskId) && (
            <TaskDetail task={tasks.find(task => task.id === detailTaskId)!} trackedMs={(tasks.find(task => task.id === detailTaskId)!.trackedMs || 0) + (taskTracking?.taskIds.includes(detailTaskId) ? liveTrackingMs : 0)} trackingSubtaskKeys={taskTracking?.subtaskKeys || []} liveTrackingMs={liveTrackingMs} activeSessionDurationMs={mode === 'focus' ? totalDuration : settings.focus * 60_000} onUpdate={updateTask} onActivate={selectTask} active={activeTaskId === detailTaskId}/>
          )}
        </aside>
      </section>

      <nav className="mobile-nav" aria-label="Mobile navigation"><button onClick={() => setPanel('tasks')}><ListTodo/>TASKS</button><button className="active"><Zap/>TIMER</button><button onClick={() => setPanel('history')}><BarChart3/>STATS</button></nav>
      <footer className="footer-line"><span>WEB WORKER: {running ? 'ACTIVE' : 'STANDBY'}</span><span>NO ACCOUNT · NO CLOUD · NO TRACKING</span><span>PWA · v1.0.0</span></footer>

      {panel === 'history' && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPanel(null)}><section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-header"><div><span>FOCUS/PROTOCOL</span><h2 id="modal-title">{panel === 'settings' ? 'SYSTEM CONFIG' : panel === 'history' ? 'SESSION LOG' : panel === 'task-detail' ? 'TASK DETAIL' : 'ACTIVE QUEUE'}</h2></div><Button variant="ghost" size="icon" onClick={() => setPanel(null)} aria-label="Close"><X/></Button></div>
        {panel === 'history' && <HistoryPanel sessions={sessions} streak={streak}/>} 
      </section></div>}
    </main>
  );
}

function TaskList({ tasks, activeTaskId, trackingTaskIds, liveTrackingMs, activeSessionDurationMs, onDetail, onCounter, onToggle, onDelete }: { tasks: Task[]; activeTaskId: string | null; trackingTaskIds:string[]; liveTrackingMs:number; activeSessionDurationMs:number; onDetail:(id:string)=>void; onCounter:(task:Task)=>void; onToggle:(task:Task)=>void; onDelete:(id:string)=>void }) {
  const [showHidden, setShowHidden] = useState(false);
  if (!tasks.length) return <div className="empty-state"><ListTodo size={20}/><p>Your queue is clear.</p><span>Add one concrete outcome to begin.</span></div>;
  const active = tasks.filter(task => !task.hidden && taskStatus(task) === 'in_progress');
  const closed = tasks.filter(task => !task.hidden && taskStatus(task) !== 'in_progress');
  const hidden = tasks.filter(task => task.hidden);
  const renderTask = (task: Task, index: number) => {
    const status = taskStatus(task); const subtaskCount = task.subtasks?.length || 0;
    const liveMs = trackingTaskIds.includes(task.id) ? liveTrackingMs : 0;
    const trackedMs = (task.trackedMs || 0) + liveMs;
    const protocolProgress = task.completed + liveMs / activeSessionDurationMs;
    const targetProgress = Math.min(100, protocolProgress / Math.max(1, task.estimate) * 100);
    return <div key={task.id} className={`task-card status-${status} ${task.id === activeTaskId ? 'active-task' : ''}`}>
      <button className="task-check" onClick={() => onToggle(task)} aria-label={status === 'done' ? 'Reopen task' : 'Complete task'}>{status === 'done' && <Check size={10}/>}</button>
      <button className="task-main" onClick={() => onDetail(task.id)} aria-label={`Open ${task.title}`}><span className="task-index">#{String(index+1).padStart(2,'0')} <b className={`task-status ${status}`}>{status.replace('_',' ')}</b></span><p>{task.title}</p><span className="task-pomos">{task.trackFocus === false ? 'NOT TRACKED' : `${protocolProgress.toFixed(liveMs ? 2 : 0)} / ${task.estimate} PROTOCOLS · ${formatTaskTime(trackedMs)}`}{task.counterEnabled && <> · {liveMs ? 'COUNTING' : 'ARMED'}</>}{(subtaskCount || task.notes) && <> · {subtaskCount} SUBTASKS{task.notes ? ' · NOTE' : ''}</>}</span>{task.trackFocus !== false && <i className="task-progress-track"><b style={{width:`${targetProgress}%`}}/></i>}</button>
      <span className="task-actions"><button className={`task-counter-button ${task.counterEnabled ? 'counter-armed' : ''} ${liveMs ? 'counter-live' : ''}`} disabled={status !== 'in_progress' || task.hidden} onClick={() => onCounter(task)} aria-label={task.counterEnabled ? `Stop counter for ${task.title}` : `Reset and arm counter for ${task.title}`}>{task.counterEnabled ? <Pause size={12}/> : <TimerReset size={12}/>}</button><button className="task-detail-button" onClick={() => onDetail(task.id)} aria-label={`Open details for ${task.title}`}><FileText size={12}/></button><button className="task-delete" onClick={() => onDelete(task.id)} aria-label="Delete task"><Trash2 size={12}/></button></span>
    </div>;
  };
  return <div className="task-groups">
    <section className="task-group"><div className="task-group-label"><span>ACTIVE</span><b>{active.length}</b></div><div className="task-list">{active.length ? active.map(renderTask) : <p className="task-group-empty">No active tasks.</p>}</div></section>
    <section className="task-group"><div className="task-group-label"><span>CLOSED</span><b>{closed.length}</b></div><div className="task-list">{closed.length ? closed.map(renderTask) : <p className="task-group-empty">No closed tasks.</p>}</div></section>
    {!!hidden.length && <section className="task-group hidden-group"><button className="hidden-toggle" onClick={() => setShowHidden(value => !value)}>{showHidden ? <EyeOff size={12}/> : <Eye size={12}/>} {showHidden ? 'HIDE HIDDEN TASKS' : `SHOW HIDDEN TASKS (${hidden.length})`}</button>{showHidden && <div className="task-list">{hidden.map(renderTask)}</div>}</section>}
  </div>;
}

function TaskDetail({ task, trackedMs, trackingSubtaskKeys, liveTrackingMs, activeSessionDurationMs, onUpdate, onActivate, active }: { task: Task; trackedMs:number; trackingSubtaskKeys:string[]; liveTrackingMs:number; activeSessionDurationMs:number; onUpdate:(task:Task)=>void; onActivate:(id:string)=>void; active:boolean }) {
  const [notes, setNotes] = useState(task.notes || '');
  const [draft, setDraft] = useState('');
  useEffect(() => { setNotes(task.notes || ''); setDraft(''); }, [task.id, task.notes]);
  const subtasks = task.subtasks || [];
  const status = taskStatus(task);
  const liveProtocolProgress = task.completed + Math.max(0, trackedMs - (task.trackedMs || 0)) / activeSessionDurationMs;
  const addSubtask = () => { const title = draft.trim(); if (!title) return; const subtask: Subtask = { id: crypto.randomUUID(), title, done:false, createdAt:Date.now() }; onUpdate({ ...task, notes, subtasks:[...subtasks,subtask] }); setDraft(''); };
  const updateSubtasks = (next: Subtask[]) => onUpdate({ ...task, notes, subtasks:next });
  const setStatus = (next: TaskStatus) => onUpdate({ ...task, notes, subtasks, status:next, done:next === 'done' });
  return <div className="task-detail-panel">
    <div className="task-detail-heading"><div><span>#{task.id.slice(0,6).toUpperCase()}</span><h3>{task.title}</h3><p>{task.trackFocus === false ? 'Focus accounting disabled' : `${liveProtocolProgress.toFixed(trackedMs > (task.trackedMs || 0) ? 2 : 0)} of ${task.estimate} focus protocols · ${formatTaskTime(trackedMs)} tracked`}</p></div><Button variant={active ? 'secondary' : 'outline'} disabled={status !== 'in_progress' || task.hidden} onClick={() => onActivate(task.id)}>{active ? <><Check/>ACTIVE TASK</> : <><Zap/>SET ACTIVE</>}</Button></div>
    <section className="task-management"><div className="detail-label"><Timer/> TASK CONTROL</div>
      <div className="status-control" role="group" aria-label="Task status">{([['in_progress','IN PROGRESS'],['done','DONE'],['canceled','CANCELED']] as [TaskStatus,string][]).map(([value,label]) => <button key={value} className={`${value} ${status === value ? 'selected' : ''}`} onClick={() => setStatus(value)}>{label}</button>)}</div>
      <div className="accounting-grid"><label className="toggle-row"><span><b>Count focus on this task</b><small>Attach completed protocols and minutes</small></span><Switch checked={task.trackFocus !== false} onCheckedChange={checked => onUpdate({ ...task, notes, subtasks, trackFocus:checked })}/></label><label className="estimate-row"><span><b>Protocol target</b><small>Planned focus sessions</small></span><span className="stepper"><button onClick={() => onUpdate({ ...task, notes, subtasks, estimate:Math.max(1,task.estimate-1) })}>−</button><strong>{task.estimate}</strong><button onClick={() => onUpdate({ ...task, notes, subtasks, estimate:Math.min(99,task.estimate+1) })}>+</button></span></label></div>
      <button className="hide-task-button" onClick={() => onUpdate({ ...task, notes, subtasks, hidden:!task.hidden })}>{task.hidden ? <Eye size={13}/> : <EyeOff size={13}/>} {task.hidden ? 'SHOW TASK IN LISTS' : 'HIDE TASK FROM LISTS'}</button>
    </section>
    <section className="task-notes"><div className="detail-label"><FileText/> NOTES <span>AUTOSAVED</span></div><textarea value={notes} onChange={event => setNotes(event.target.value)} onBlur={() => onUpdate({ ...task, notes, subtasks })} placeholder="Capture context, links, decisions, or what 'done' looks like…"/></section>
    <section className="subtask-section"><div className="detail-label"><ListChecks/> SUBTASKS <span>{subtasks.filter(item => item.done).length}/{subtasks.length}</span></div>
      <div className="subtask-list">{subtasks.length ? subtasks.map(subtask => { const key = `${task.id}:${subtask.id}`; const liveSubtaskMs = trackingSubtaskKeys.includes(key) ? liveTrackingMs : 0; const subtaskMs = (subtask.trackedMs || 0) + liveSubtaskMs; return <div key={subtask.id} className={subtask.done ? 'done' : ''}><button className="subtask-check" onClick={() => updateSubtasks(subtasks.map(item => item.id === subtask.id ? {...item,done:!item.done}:item))}>{subtask.done && <Check size={11}/>}</button><span>{subtask.title}<small className="subtask-time">{formatTaskTime(subtaskMs)}{subtask.counterEnabled ? (liveSubtaskMs ? ' · COUNTING' : ' · ARMED') : ''}</small></span><button className={`subtask-counter ${subtask.counterEnabled ? 'armed' : ''} ${liveSubtaskMs ? 'live' : ''}`} disabled={subtask.done || task.hidden || taskStatus(task) !== 'in_progress'} onClick={() => onUpdate({...task, subtasks:subtasks.map(item => item.id === subtask.id ? {...item,counterEnabled:!item.counterEnabled}:item)})} aria-label={subtask.counterEnabled ? `Pause counter for ${subtask.title}` : `Arm counter for ${subtask.title}`}>{subtask.counterEnabled ? <Pause size={12}/> : <TimerReset size={12}/>}</button><button className="subtask-delete" onClick={() => updateSubtasks(subtasks.filter(item => item.id !== subtask.id))} aria-label={`Delete ${subtask.title}`}><Trash2 size={12}/></button></div>; }) : <p className="subtask-empty">Break this task into small, verifiable steps.</p>}</div>
      <form className="subtask-entry" onSubmit={event => { event.preventDefault(); addSubtask(); }}><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a subtask…"/><Button type="submit" size="sm"><Plus/>ADD</Button></form>
    </section>
  </div>;
}

function SettingsPanel({ settings, update, ambient, toggleAmbient, uploadBackground, clearBackground, hasBackground, onReset }: { settings: Settings; update:(patch:Partial<Settings>)=>void; ambient:boolean; toggleAmbient:()=>void; uploadBackground:(file?:File)=>void; clearBackground:()=>void; hasBackground:boolean; onReset:()=>void }) {
  const durations: [keyof Pick<Settings,'focus'|'short'|'long'>, string][] = [['focus','Focus duration'],['short','Short break'],['long','Long break']];
  const requestNotifications = async (checked: boolean) => { if (checked && Notification.permission !== 'granted') await Notification.requestPermission(); update({ notifications: checked }); };
  return <div className="settings-grid">
    <div className="setting-section"><h3>TIMER SEQUENCE</h3>{durations.map(([key,label]) => <label className="duration-row" key={key}><span>{label}</span><span className="stepper"><button onClick={() => update({ [key]: Math.max(1,settings[key]-1) })}>−</button><strong>{settings[key]} min</strong><button onClick={() => update({ [key]: Math.min(90,settings[key]+1) })}>+</button></span></label>)}</div>
    <div className="setting-section"><h3>AUTOMATION</h3><label className="toggle-row"><span><b>Desktop notifications</b><small>Signal when a protocol completes</small></span><Switch checked={settings.notifications} onCheckedChange={requestNotifications}/></label><label className="toggle-row"><span><b>Auto-start next phase</b><small>Continue without manual input</small></span><Switch checked={settings.autoStart} onCheckedChange={checked => update({autoStart:checked})}/></label></div>
    <div className="setting-section"><h3>AMBIENT CHANNEL</h3><div className="volume-row"><Button variant="outline" onClick={toggleAmbient}>{ambient ? <Pause/> : <Volume2/>}{ambient ? 'Stop noise' : 'Start brown noise'}</Button><span>{settings.volume}%</span></div><Slider value={[settings.volume]} onValueChange={value => update({volume:Array.isArray(value)?value[0]:settings.volume})} min={0} max={100}/></div>
    <div className="setting-section"><h3>LOCAL BACKGROUND</h3><p className="setting-copy">The image is resized locally, displayed in full, and stored only in IndexedDB on this device.</p>{hasBackground && <div className="visual-adjustments"><label className="visual-adjustment"><div><span>BLUR</span><b>{settings.backgroundBlur}px</b></div><input className="visual-range" type="range" min="0" max="40" step="1" value={settings.backgroundBlur} onChange={event => update({backgroundBlur:event.currentTarget.valueAsNumber})}/></label><label className="visual-adjustment"><div><span>BRIGHTNESS</span><b>{settings.backgroundBrightness}%</b></div><input className="visual-range" type="range" min="35" max="150" step="1" value={settings.backgroundBrightness} onChange={event => update({backgroundBrightness:event.currentTarget.valueAsNumber})}/></label></div>}<div className="background-actions"><label className="upload-button"><ImagePlus size={15}/> CHOOSE IMAGE<input type="file" accept="image/*" onChange={event => uploadBackground(event.target.files?.[0])}/></label>{hasBackground && <Button variant="destructive" onClick={clearBackground}><Trash2/>Remove</Button>}</div></div>
    <div className="setting-section reset-section"><h3>JARGON FILE // DESTRUCTIVE OPS</h3><p className="setting-copy">Purge every local record and return the protocol to factory state.</p><button className="reset-everything" onClick={onReset}><span>$ reset --everything</span><b>RESET EVERYTHING</b><RotateCcw size={13}/></button></div>
  </div>;
}

function MusicPanel({ musicTrack, musicPlaying, playMusic, nextMusic, stopMusic }: { musicTrack:number|null; musicPlaying:boolean; playMusic:(index:number)=>void; nextMusic:()=>void; stopMusic:()=>void }) {
  const [source, setSource] = useState<'local' | 'spotify'>('local');
  return <div className="music-panel"><div className="music-panel-intro"><span>$ audio.channel</span><p>Choose a local track or stream your Spotify playlist. Both sources can play together.</p></div><div className="music-source-tabs" role="tablist" aria-label="Music source"><button className={source === 'local' ? 'active' : ''} onClick={() => setSource('local')} role="tab" aria-selected={source === 'local'}>LOCAL AUDIO</button><button className={source === 'spotify' ? 'active spotify' : 'spotify'} onClick={() => setSource('spotify')} role="tab" aria-selected={source === 'spotify'}>SPOTIFY</button></div><div className={`music-source-panel ${source === 'local' ? '' : 'is-hidden'}`} aria-hidden={source !== 'local'}><select className="music-menu" value={musicTrack ?? ''} onChange={event => { const index = Number(event.target.value); if (Number.isInteger(index)) playMusic(index); }} aria-label="Select music"><option value="">Select a track…</option>{MUSIC_TRACKS.map(([label], index) => <option value={index} key={label}>{label}</option>)}</select><div className={`music-visualizer ${musicPlaying ? 'playing' : ''}`} aria-label={musicPlaying ? 'Music playing' : 'Music stopped'}>{Array.from({length:18}, (_, i) => <i key={i}/>)}</div><div className="music-panel-controls"><button onClick={nextMusic}><SkipForward size={14}/> NEXT TRACK</button><button onClick={stopMusic}>{musicPlaying ? <Pause size={14}/> : <VolumeX size={14}/>} {musicPlaying ? 'STOP MUSIC' : 'STOPPED'}</button></div><small className="music-status">{musicPlaying ? 'PLAYING · LOOP ENABLED' : 'STOPPED · LOCAL ONLY'}</small></div><div className={`music-source-panel ${source === 'spotify' ? '' : 'is-hidden'}`} aria-hidden={source !== 'spotify'}><div className="spotify-embed-wrap"><iframe title="Spotify playlist" src="https://open.spotify.com/embed/playlist/2Heml4mBceQNn08PehiRIK?utm_source=generator" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"/><small className="music-status">SPOTIFY · EXTERNAL PLAYER · CLOSE PANEL TO KEEP PLAYING</small></div></div></div>;
}

function AboutPanel() {
  return <div className="about-panel"><span className="about-kicker">$ about.focus_protocol</span><h2>Focus Protocol</h2><p>Este Pomodoro está inspirado en <a href="https://pomodorotimer.online" target="_blank" rel="noreferrer">pomodorotimer.online</a>. Solo lo he adaptado a mi gusto; todo el crédito es para el creador de dicha web. Por favor, apóyalo.</p><div className="about-rule"/><small>LOCAL TOOL · BUILT FOR DEEP WORK</small></div>;
}

function HistoryPanel({ sessions, streak }: { sessions: Session[]; streak:number }) {
  const focus = sessions.filter(s => s.mode === 'focus'); const total = focus.reduce((sum,s) => sum+s.duration,0);
  return <div><div className="history-summary"><div><strong>{focus.length}</strong><span>FOCUS SESSIONS</span></div><div><strong>{total}<small>m</small></strong><span>TOTAL FOCUS</span></div><div><strong>{streak}</strong><span>DAY STREAK</span></div></div>
    <div className="history-list">{sessions.length ? sessions.slice(0,30).map(session => <div key={session.id}><span className={`session-dot ${session.mode}`}/><p><b>{session.mode === 'focus' ? 'Focus protocol' : session.mode === 'short' ? 'Short recovery' : 'Long recovery'}</b><small>{new Date(session.completedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · {new Date(session.completedAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></p><strong>{session.duration}m</strong></div>) : <div className="history-empty"><Bell/><p>No signal yet. Complete your first focus protocol.</p></div>}</div>
  </div>;
}
