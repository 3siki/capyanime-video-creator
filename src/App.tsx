/**
 * Capy Anime Creator
 * AI-powered Japanese anime-style YouTube video generator
 * Stack: React 19 + Claude AI (script) + fal.ai (image & video)
 */

import { useState } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Play, Pause, Download, Loader2,
  ChevronRight, ChevronLeft, AlertCircle, Clock,
  Film, CheckCircle2, ImageIcon,
  Video, Key, Wand2, RotateCcw, RefreshCw,
} from 'lucide-react';

// ─── AI Model IDs ────────────────────────────────────────────────────────────
const MODEL_SCRIPT = 'claude-sonnet-4-6';
const MODEL_IMAGE  = 'fal-ai/flux/schnell';
const MODEL_VIDEO  = 'fal-ai/ltx-video-v095/image-to-video';  // ~$0.04/클립

// ─── Types ───────────────────────────────────────────────────────────────────

type VideoType  = 'shorts' | 'longform';
type AssetState = 'idle' | 'loading' | 'done' | 'error';
type GenStep    = 'idle' | 'script' | 'assets' | 'video' | 'done';

interface Scene {
  id:          string;
  text:        string;         // Korean narration
  imagePrompt: string;         // English image prompt
  imageUrl?:   string;
  videoUrl?:   string;
  imageState:  AssetState;
  videoState:  AssetState;
}

interface GeneratedScript {
  title:  string;
  scenes: Scene[];
}

// ─── Utilities ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
  const FAL_KEY       = process.env.FAL_KEY ?? '';

  // ── State ──────────────────────────────────────────────────────────────────
  const [topic,        setTopic]        = useState('');
  const [videoType,    setVideoType]    = useState<VideoType>('shorts');
  const [genStep,      setGenStep]      = useState<GenStep>('idle');
  const [progress,     setProgress]     = useState(0);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [script,       setScript]       = useState<GeneratedScript | null>(null);
  const [activeIdx,    setActiveIdx]    = useState(0);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Auto-advance slideshow ──────────────────────────────────────────────────
  // (Plays through scenes every 5s when isPlaying is true)
  // Handled via video autoplay loop + manual controls

  // ── Generation pipeline ─────────────────────────────────────────────────────
  const generate = async () => {
    if (!topic.trim() || isGenerating) return;
    if (!ANTHROPIC_KEY) {
      setError('.env.local 파일에 ANTHROPIC_API_KEY를 설정하고 재시작해주세요.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setScript(null);
    setActiveIdx(0);
    setIsPlaying(false);

    const client = new Anthropic({
      apiKey: ANTHROPIC_KEY,
      dangerouslyAllowBrowser: true,
    });

    try {
      // ── Step 1: Script via Claude ───────────────────────────────────────────
      setGenStep('script');
      setProgress(5);
      setStatusMsg('Claude가 대본을 작성하고 있어요...');

      const sceneRange = videoType === 'shorts' ? '6~8' : '15~20';
      const formatLabel = videoType === 'shorts' ? '60초 숏츠' : '5분 롱폼';

      const scriptMsg = await client.messages.create({
        model: MODEL_SCRIPT,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"

이 주제로 유튜브 ${formatLabel} (${sceneRange}장면) 애니메이션 영상 대본을 작성해줘.
주인공은 반드시 귀엽고 통통한 '카피바라(Capybara)' — 일본 애니메이션 스타일.

각 장면:
- text: 나레이션 (한국어, 친근하고 재미있게, 1~2문장)
- imagePrompt: 이미지 프롬프트 (영어, 구체적으로. 글자·텍스트·자막 절대 금지)

반드시 JSON만 출력 (다른 텍스트 없이):
{ "title": "...", "scenes": [{ "text": "...", "imagePrompt": "..." }] }`,
        }],
      });

      const rawText = scriptMsg.content[0].type === 'text' ? scriptMsg.content[0].text : '';
      // Extract JSON even if Claude adds a small preamble
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('스크립트 파싱 실패 — JSON을 찾을 수 없습니다.');

      const raw = JSON.parse(jsonMatch[0]) as {
        title: string;
        scenes: { text: string; imagePrompt: string }[];
      };

      const scenes: Scene[] = raw.scenes.map((s, i) => ({
        id:          `scene-${i}`,
        text:        s.text,
        imagePrompt: s.imagePrompt,
        imageState:  'idle',
        videoState:  'idle',
      }));

      const draft: GeneratedScript = { title: raw.title, scenes };
      setScript({ ...draft });
      setProgress(15);

      // ── Step 2: Image per scene (fal.ai Flux Schnell) ──────────────────────
      setGenStep('assets');
      fal.config({ credentials: FAL_KEY });
      const imageSize = videoType === 'shorts' ? 'portrait_16_9' : 'landscape_16_9';

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        setProgress(15 + (i / scenes.length) * 52);
        setStatusMsg(`이미지 생성 중... (${i + 1}/${scenes.length})`);

        scene.imageState = 'loading';
        setScript({ ...draft, scenes: [...scenes] });

        try {
          const imgRes = await fal.subscribe(MODEL_IMAGE, {
            input: {
              prompt: `Japanese anime style, cute fluffy capybara as protagonist, vibrant colors, cinematic lighting, high quality illustration, no text, no watermarks, no subtitles. ${scene.imagePrompt}`,
              image_size: imageSize,
              num_images: 1,
              num_inference_steps: 4,
            },
          }) as any;

          const imageUrl = imgRes?.data?.images?.[0]?.url as string | undefined;
          if (imageUrl) {
            scene.imageUrl   = imageUrl;
            scene.imageState = 'done';
          } else {
            scene.imageState = 'error';
          }
        } catch (e) {
          console.error('Image error:', e);
          scene.imageState = 'error';
        }

        setScript({ ...draft, scenes: [...scenes] });
        await sleep(300);
      }

      // ── Step 3: Video per scene (fal.ai Kling v1.6) ───────────────────────
      setGenStep('video');
      const aspectRatio = videoType === 'shorts' ? '9:16' : '16:9';

      if (FAL_KEY) {
        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          setProgress(67 + (i / scenes.length) * 30);
          setStatusMsg(`동영상 생성 중... (${i + 1}/${scenes.length}) — 장면당 30초~2분 소요`);

          scene.videoState = 'loading';
          setScript({ ...draft, scenes: [...scenes] });

          try {
            let imageUrl: string | undefined;
            if (scene.imageUrl) {
              if (scene.imageUrl.startsWith('http')) {
                imageUrl = scene.imageUrl;
              } else {
                const res  = await fetch(scene.imageUrl);
                const blob = await res.blob();
                const file = new File([blob], `scene-${i}.jpg`, { type: 'image/jpeg' });
                imageUrl   = await fal.storage.upload(file);
              }
            }

            if (!imageUrl) throw new Error('이미지가 없어 영상 생성 불가');

            const result = await fal.subscribe(MODEL_VIDEO, {
              input: {
                prompt: `Japanese anime style, cute fluffy capybara character, smooth cinematic animation, vibrant colors, high quality, no text, no watermarks. ${scene.imagePrompt}`,
                image_url:   imageUrl,
                resolution:  aspectRatio === '9:16' ? '480p' : '720p',
                aspect_ratio: aspectRatio as any,
              },
              pollInterval: 4_000,
            }) as any;

            const videoUri: string | undefined = result?.data?.video?.url;
            if (videoUri) {
              const blob       = await fetch(videoUri).then(r => r.blob());
              scene.videoUrl   = URL.createObjectURL(blob);
              scene.videoState = 'done';
            } else {
              scene.videoState = 'error';
            }
          } catch (e: any) {
            console.error('Video error:', e);
            scene.videoState = 'error';
          }

          setScript({ ...draft, scenes: [...scenes] });
          await sleep(300);
        }
      } else {
        scenes.forEach(s => { s.videoState = 'skipped' as any; });
        setScript({ ...draft, scenes: [...scenes] });
      }

      setGenStep('done');
      setProgress(100);
      setStatusMsg('완성!');
      setActiveIdx(0);
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? '생성 중 오류가 발생했습니다.');
      setGenStep('idle');
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Retry a single scene's video ───────────────────────────────────────────
  const retryVideo = async (idx: number) => {
    if (!script || !FAL_KEY) return;
    const scenes = [...script.scenes];
    const scene  = scenes[idx];
    scene.videoState = 'loading';
    setScript({ ...script, scenes });

    fal.config({ credentials: FAL_KEY });
    const aspectRatio = videoType === 'shorts' ? '9:16' : '16:9';

    try {
      let imageUrl: string | undefined;
      if (scene.imageUrl) {
        if (scene.imageUrl.startsWith('http')) {
          imageUrl = scene.imageUrl;
        } else {
          const res  = await fetch(scene.imageUrl);
          const blob = await res.blob();
          const file = new File([blob], `scene-${idx}.jpg`, { type: 'image/jpeg' });
          imageUrl   = await fal.storage.upload(file);
        }
      }
      if (!imageUrl) throw new Error('이미지 없음');

      const result = await fal.subscribe(MODEL_VIDEO, {
        input: {
          prompt: `Japanese anime style, cute fluffy capybara character, smooth cinematic animation, vibrant colors, high quality, no text. ${scene.imagePrompt}`,
          image_url:    imageUrl,
          resolution:   videoType === 'shorts' ? '480p' : '720p',
          aspect_ratio: (videoType === 'shorts' ? '9:16' : '16:9') as any,
        },
        pollInterval: 4_000,
      }) as any;

      const videoUri: string | undefined = result?.data?.video?.url;
      if (videoUri) {
        const blob       = await fetch(videoUri).then(r => r.blob());
        scene.videoUrl   = URL.createObjectURL(blob);
        scene.videoState = 'done';
      } else {
        scene.videoState = 'error';
      }
    } catch (e) {
      console.error('Retry video error:', e);
      scene.videoState = 'error';
    }

    setScript({ ...script, scenes });
  };

  // ── Download helpers ────────────────────────────────────────────────────────
  const downloadScene = (scene: Scene, idx: number) => {
    const url = scene.videoUrl ?? scene.imageUrl;
    if (!url) return;
    const ext = scene.videoUrl ? 'mp4' : 'jpg';
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `capyanime-${String(idx + 1).padStart(2, '0')}.${ext}`;
    a.click();
  };

  const downloadAll = async () => {
    if (!script) return;
    for (let i = 0; i < script.scenes.length; i++) {
      downloadScene(script.scenes[i], i);
      await sleep(350);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const isIdle    = !isGenerating;
  const scene     = script?.scenes[activeIdx];
  const stepOrder: GenStep[] = ['script', 'assets', 'video', 'done'];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans">

      {/* ── Ambient background glows ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-1/3 -left-1/4 w-3/4 h-3/4 bg-orange-500/5 blur-[200px] rounded-full" />
        <div className="absolute -bottom-1/3 -right-1/4 w-2/3 h-2/3 bg-violet-600/5 blur-[200px] rounded-full" />
      </div>

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080808]/85 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-display font-bold text-[15px] tracking-tight">
              Capy<span className="text-orange-400">Anime</span>
            </span>
          </div>

          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            ANTHROPIC_KEY
              ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400'
              : 'border-red-500/20 bg-red-500/8 text-red-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              ANTHROPIC_KEY ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
            }`} />
            {ANTHROPIC_KEY ? 'API 연결됨' : 'API 키 없음'}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-5 sm:px-8 py-14 space-y-16">

        {/* ── Hero ── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="text-center space-y-5 pt-4"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/8 text-orange-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            Claude AI · fal.ai Flux · Kling v1.6
          </div>

          <h1 className="font-display font-bold text-5xl sm:text-6xl md:text-7xl tracking-tight leading-[1.05]">
            카피바라 AI<br />
            <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-orange-500 bg-clip-text text-transparent">
              영상 메이커
            </span>
          </h1>

          <p className="text-white/40 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
            주제 하나만 입력하면 — 대본, 이미지, 동영상까지
            <br />카피바라 애니메이션 영상을 AI가 완전 자동으로 만들어줘요.
          </p>
        </motion.section>

        {/* ── API Key Warning ── */}
        <AnimatePresence>
          {!ANTHROPIC_KEY && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-xl mx-auto p-4 bg-amber-500/8 border border-amber-500/20 rounded-2xl flex gap-3 items-start"
            >
              <Key className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-300">API 키 설정이 필요해요</p>
                <p className="text-xs text-amber-200/55 leading-relaxed">
                  프로젝트 루트에{' '}
                  <code className="bg-white/8 px-1 py-0.5 rounded text-amber-300/80">.env.local</code>
                  {' '}파일을 만들고{' '}
                  <code className="bg-white/8 px-1 py-0.5 rounded text-amber-300/80">ANTHROPIC_API_KEY=발급받은_키</code>
                  {' '}를 추가한 뒤 서버를 재시작하세요.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Controls ── */}
        <section className="max-w-xl mx-auto space-y-5">

          {/* Topic input */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
              영상 주제
            </label>
            <div className="relative group">
              <input
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && isIdle && generate()}
                placeholder="예: 카피바라가 우주를 탐험하는 이야기"
                disabled={isGenerating}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4 text-base placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500/35 transition-all disabled:opacity-50"
              />
              <Wand2 className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/15 group-focus-within:text-orange-400/60 transition-colors" />
            </div>
          </div>

          {/* Video type */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
              영상 형식
            </label>
            <div className="grid grid-cols-2 gap-3">
              {([
                { type: 'shorts'   as const, Icon: Clock, label: '숏츠',  sub: '세로 9:16 · 약 60초', color: 'orange' },
                { type: 'longform' as const, Icon: Film,  label: '롱폼',  sub: '가로 16:9 · 약 5분',  color: 'violet' },
              ]).map(({ type, Icon, label, sub, color }) => {
                const active = videoType === type;
                return (
                  <button
                    key={type}
                    onClick={() => setVideoType(type)}
                    disabled={isGenerating}
                    className={`p-4 rounded-2xl border transition-all text-left disabled:opacity-50 ${
                      active
                        ? color === 'orange'
                          ? 'bg-orange-500/10 border-orange-500/40 text-orange-400'
                          : 'bg-violet-500/10 border-violet-500/40 text-violet-400'
                        : 'bg-white/[0.03] border-white/[0.07] text-white/35 hover:bg-white/[0.05] hover:border-white/[0.12] hover:text-white/55'
                    }`}
                  >
                    <Icon className="w-5 h-5 mb-2.5" />
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs opacity-50 mt-0.5">{sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={!topic.trim() || isGenerating || !ANTHROPIC_KEY}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl font-display font-bold text-lg shadow-xl shadow-orange-500/15 hover:shadow-orange-500/30 hover:brightness-110 hover:scale-[1.015] active:scale-[0.99] transition-all disabled:opacity-35 disabled:hover:scale-100 disabled:hover:brightness-100 disabled:shadow-none flex items-center justify-center gap-2.5"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                AI가 열심히 만들고 있어요...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                영상 만들기 시작
              </>
            )}
          </button>

          {/* Error message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 bg-red-500/8 border border-red-500/20 rounded-2xl flex gap-3 items-start text-red-300"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="text-sm leading-relaxed">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ── Results ── */}
        <AnimatePresence>
          {script && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Header row */}
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1.5">
                    완성된 영상
                  </p>
                  <h2 className="font-display font-bold text-xl sm:text-2xl leading-tight">
                    {script.title}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setScript(null); setGenStep('idle'); setError(null); }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/40 bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] hover:text-white/60 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    초기화
                  </button>
                  <button
                    onClick={downloadAll}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    전체 다운로드
                  </button>
                </div>
              </div>

              {/* Main two-column layout */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">

                {/* ── Left: Scene viewer ── */}
                <div className="xl:col-span-2 space-y-4">
                  {/* Video / image preview */}
                  <div className={`relative bg-black rounded-3xl overflow-hidden border border-white/[0.07] shadow-2xl ${
                    videoType === 'shorts'
                      ? 'aspect-[9/16] max-w-[300px] mx-auto xl:mx-0'
                      : 'aspect-video'
                  }`}>
                    <AnimatePresence mode="wait">
                      {scene && (
                        <motion.div
                          key={activeIdx}
                          initial={{ opacity: 0, scale: 1.03 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="absolute inset-0"
                        >
                          {scene.videoUrl ? (
                            <video
                              src={scene.videoUrl}
                              autoPlay loop muted
                              className="w-full h-full object-cover"
                            />
                          ) : scene.imageUrl ? (
                            <img
                              src={scene.imageUrl}
                              className="w-full h-full object-cover"
                              alt={`장면 ${activeIdx + 1}`}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/20">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span className="text-xs font-medium">생성 중...</span>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Player controls overlay */}
                    <div className="absolute bottom-0 inset-x-0 p-3.5 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                          disabled={activeIdx === 0}
                          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setIsPlaying(p => !p)}
                          className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center transition-all shadow-lg shadow-orange-500/30"
                        >
                          {isPlaying
                            ? <Pause className="w-4 h-4" />
                            : <Play className="w-4 h-4 ml-0.5" />}
                        </button>

                        <button
                          onClick={() => setActiveIdx(i => Math.min((script?.scenes.length ?? 1) - 1, i + 1))}
                          disabled={activeIdx === (script?.scenes.length ?? 1) - 1}
                          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-white/40 font-medium tabular-nums">
                          {activeIdx + 1} / {script.scenes.length}
                        </span>
                        <button
                          onClick={() => scene && downloadScene(scene, activeIdx)}
                          disabled={!scene?.imageUrl && !scene?.videoUrl}
                          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Narration text */}
                  <div className="p-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/25 mb-2">
                      나레이션
                    </p>
                    <p className="text-sm text-white/70 leading-relaxed">{scene?.text}</p>
                  </div>

                  {/* Asset state pills */}
                  {scene && (
                    <div className="flex gap-2 flex-wrap">
                      {([
                        { label: '이미지', state: scene.imageState, Icon: ImageIcon },
                        { label: '영상',   state: scene.videoState, Icon: Video,
                          onRetry: scene.videoState === 'error' ? () => retryVideo(activeIdx) : undefined },
                      ]).map(({ label, state, Icon, onRetry }) => (
                        <div
                          key={label}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                            state === 'done'    ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400' :
                            state === 'loading' ? 'bg-orange-500/8  border-orange-500/20  text-orange-400'  :
                            state === 'error'   ? 'bg-red-500/8     border-red-500/20     text-red-400'     :
                                                  'bg-white/[0.04]  border-white/[0.07]   text-white/25'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          {label}
                          {state === 'loading' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {state === 'done'    && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {onRetry && (
                            <button onClick={onRetry} className="ml-0.5 hover:opacity-70 transition-opacity">
                              <RefreshCw className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Right: Scene list ── */}
                <div className="space-y-2 max-h-[680px] overflow-y-auto scrollbar-thin pr-0.5">
                  {script.scenes.map((sc, i) => (
                    <motion.button
                      key={sc.id}
                      onClick={() => { setActiveIdx(i); setIsPlaying(false); }}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className={`w-full flex gap-3 p-3 rounded-2xl border text-left transition-all ${
                        i === activeIdx
                          ? 'bg-orange-500/10 border-orange-500/30'
                          : 'bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.045] hover:border-white/10'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="relative w-[52px] h-[52px] rounded-xl overflow-hidden bg-white/[0.05] flex-shrink-0">
                        {sc.imageUrl ? (
                          <img src={sc.imageUrl} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {sc.imageState === 'loading'
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" />
                              : <ImageIcon className="w-3.5 h-3.5 text-white/15" />}
                          </div>
                        )}
                        {sc.videoState === 'done' && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <Video className="w-3 h-3 text-orange-400" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 py-0.5 space-y-1.5">
                        <p className={`text-[11px] font-semibold ${
                          i === activeIdx ? 'text-orange-400' : 'text-white/30'
                        }`}>
                          장면 {i + 1}
                        </p>
                        <p className="text-[11px] text-white/45 leading-relaxed line-clamp-2">
                          {sc.text}
                        </p>
                        {/* Status dots */}
                        <div className="flex gap-1">
                          {([sc.imageState, sc.videoState] as AssetState[]).map((st, si) => (
                            <span
                              key={si}
                              className={`w-1.5 h-1.5 rounded-full ${
                                st === 'done'    ? 'bg-emerald-400' :
                                st === 'loading' ? 'bg-orange-400 animate-pulse' :
                                st === 'error'   ? 'bg-red-400' :
                                                   'bg-white/15'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.05] mt-20 py-8 text-center">
        <p className="text-white/20 text-xs">
          Capy Anime Creator · Powered by Claude AI, fal.ai Flux &amp; Kling
        </p>
      </footer>

      {/* ── Fixed bottom progress bar ── */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-0 inset-x-0 z-50 p-4 pb-5 bg-[#0d0d0d]/95 border-t border-white/[0.08] backdrop-blur-xl"
          >
            <div className="max-w-2xl mx-auto space-y-2.5">
              {/* Step pills */}
              <div className="flex items-center gap-3 flex-wrap">
                {([
                  { step: 'script', label: '대본',   emoji: '📝' },
                  { step: 'assets', label: '이미지',  emoji: '🎨' },
                  { step: 'video',  label: '동영상',  emoji: '🎬' },
                  { step: 'done',   label: '완료',    emoji: '✨' },
                ] as { step: GenStep; label: string; emoji: string }[]).map(({ step, label, emoji }) => {
                  const ci = stepOrder.indexOf(genStep);
                  const si = stepOrder.indexOf(step);
                  const active = genStep === step;
                  const done   = ci > si && genStep !== 'idle';
                  return (
                    <div key={step} className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                      active ? 'text-orange-400 border-orange-500/30 bg-orange-500/10' :
                      done   ? 'text-emerald-400 border-emerald-500/20 bg-emerald-500/8' :
                               'text-white/20 border-white/[0.06] bg-transparent'
                    }`}>
                      <span>{emoji}</span>
                      <span>{label}</span>
                      {active && <Loader2 className="w-3 h-3 animate-spin" />}
                      {done   && <CheckCircle2 className="w-3 h-3" />}
                    </div>
                  );
                })}
                <span className="ml-auto text-xs text-white/40 font-medium">{statusMsg}</span>
              </div>

              {/* Progress bar + % */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full"
                    animate={{ width: `${progress}%` }}
                    transition={{ ease: 'easeOut', duration: 0.6 }}
                  />
                </div>
                <span className="text-xs font-semibold text-white/40 tabular-nums w-9 text-right">
                  {Math.round(progress)}%
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
