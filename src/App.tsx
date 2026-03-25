/**
 * Capy Anime Creator
 * Stack: React 19 + Claude AI + fal.ai (Flux + Kling)
 * Flow: Script → Review/Edit → Images → Review/Upload → Videos → Merge
 */

import { useState, useRef } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles, Play, Pause, Download, Loader2,
  ChevronRight, ChevronLeft, AlertCircle, Clock, Film,
  CheckCircle2, ImageIcon, Video, Key, Wand2, RotateCcw,
  RefreshCw, Merge, Upload, ChevronDown, Pencil,
} from 'lucide-react';

// ─── Models ──────────────────────────────────────────────────────────────────
const MODEL_SCRIPT = 'claude-sonnet-4-6';
const MODEL_IMAGE  = 'fal-ai/flux/schnell';
const MODEL_VIDEO  = 'fal-ai/kling-video/v1.6/standard/image-to-video';

// ─── Character & Style Anchors ───────────────────────────────────────────────
const CHAR_ANCHOR = [
  'single capybara character', 'round chubby body', 'short stubby legs',
  'small rounded ears', 'tiny expressive black dot eyes', 'warm medium-brown fur',
  'slightly open calm smile', 'chibi anime proportions', 'large head small body ratio',
].join(', ');

const STYLE_ANCHOR = [
  'Japanese anime style', 'Studio Ghibli inspired', '2D flat illustration',
  'bold clean outlines', 'soft cel shading', 'vibrant saturated colors',
  'comic expressive mood', 'high quality',
  'absolutely no text', 'no letters', 'no words', 'no Korean', 'no Chinese', 'no Japanese characters',
  'no subtitles', 'no captions', 'no watermarks', 'no labels', 'no signs with writing',
  'no UI elements', 'text-free image',
].join(', ');

const buildImagePrompt = (p: string, characterStyle?: string) =>
  `${CHAR_ANCHOR}${characterStyle ? `, ${characterStyle}` : ''}, ${STYLE_ANCHOR}, ${p}`;
const buildVideoPrompt = (p: string, characterStyle?: string) =>
  `${CHAR_ANCHOR}${characterStyle ? `, ${characterStyle}` : ''}, ${STYLE_ANCHOR}, smooth cinematic animation, dynamic camera movement, character moves and reacts expressively, ${p}`;

// ─── Types ───────────────────────────────────────────────────────────────────
type VideoType  = 'shorts' | 'longform';
type AssetState = 'idle' | 'loading' | 'done' | 'error';
type AppPhase   = 'input' | 'script-review' | 'image-gen' | 'image-review' | 'video-gen' | 'done';

interface Scene {
  id:           string;
  text:         string;
  imagePrompt:  string;
  motionPrompt: string;
  imageUrl?:    string;
  videoUrl?:    string;
  imageState:   AssetState;
  videoState:   AssetState;
}

interface Script { title: string; scenes: Scene[]; characterStyle?: string; }

// ─── Util ────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
  const FAL_KEY       = process.env.FAL_KEY ?? '';

  const [phase,         setPhase]         = useState<AppPhase>('input');
  const [topic,         setTopic]         = useState('');
  const [videoType,     setVideoType]     = useState<VideoType>('shorts');
  const [script,        setScript]        = useState<Script | null>(null);
  const [progress,      setProgress]      = useState(0);
  const [statusMsg,     setStatusMsg]     = useState('');
  const [error,         setError]         = useState<string | null>(null);
  const [isLoading,     setIsLoading]     = useState(false);
  const [activeIdx,     setActiveIdx]     = useState(0);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [mergedVideoUrl,setMergedVideoUrl]= useState<string | null>(null);
  const [isMerging,     setIsMerging]     = useState(false);
  const [mergeMsg,      setMergeMsg]      = useState('');
  const [uploadingIdx,  setUploadingIdx]  = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const updateScene = (idx: number, patch: Partial<Scene>) => {
    setScript(prev => {
      if (!prev) return prev;
      const scenes = prev.scenes.map((s, i) => i === idx ? { ...s, ...patch } : s);
      return { ...prev, scenes };
    });
  };

  const resetAll = () => {
    setPhase('input'); setScript(null); setError(null);
    setProgress(0); setStatusMsg(''); setMergedVideoUrl(null);
    setActiveIdx(0); setIsPlaying(false);
  };

  // ── Step 1: Generate script ─────────────────────────────────────────────────
  const generateScript = async () => {
    if (!topic.trim() || isLoading || !ANTHROPIC_KEY) return;
    setIsLoading(true);
    setError(null);

    try {
      const sceneRange  = videoType === 'shorts' ? '6~8' : '15~20';
      const formatLabel = videoType === 'shorts' ? '60초 숏츠' : '5분 롱폼';

      const client = new Anthropic({ apiKey: ANTHROPIC_KEY, dangerouslyAllowBrowser: true });
      const msg = await client.messages.create({
        model: MODEL_SCRIPT,
        max_tokens: 6000,
        messages: [{
          role: 'user',
          content: `주제: "${topic}"

유튜브 ${formatLabel} (${sceneRange}장면) 애니메이션 대본을 작성해줘.
주인공: 귀엽고 통통한 카피바라 캐릭터. 귀엽고 코믹한 일본 애니메이션 스타일이 기본.

**characterStyle 작성 규칙:**
주제에 맞게 카피바라의 외형을 스타일링해줘 (의상, 소품, 헤어스타일 등).

⚠️ 중요 — 주인공의 도덕성 판단:
- 예술가/과학자/탐험가/긍정적 인물 → 카피바라가 그 인물 스타일로 변장
- 범죄자/마약왕/독재자/부정적 인물 → 카피바라는 그를 쫓는 영웅 역할 (형사, 경찰, 판사, 탐정 등)
  이 경우 나쁜 인물은 배경/포스터 등으로만 등장, 카피바라는 항상 정의의 편
- 카피바라는 절대 악당이나 부정적 인물로 묘사하지 않음

예시:
- 지미 헨드릭스: "afro-style puffed fur, psychedelic fringe jacket in purple and orange, electric guitar on back, round tinted sunglasses, peace sign bandana on head"
- 프레디 머큐리: "pencil mustache drawn on snout, white sleeveless leotard, yellow military jacket draped on shoulders, holding microphone stand"
- 마약왕/범죄자 주제: "wearing detective trench coat and fedora hat, holding magnifying glass, DEA badge on chest, determined heroic expression" (카피바라 = 정의의 형사)
- 독재자/악당 주제: "wearing heroic resistance fighter outfit, holding torch of freedom, brave expression"
- 우주 탐험: "NASA white spacesuit with mission patches, bubble helmet, space boots"
- 주제가 특별한 인물/테마가 없으면: "" (빈 문자열)

**imagePrompt 작성 규칙 (매우 중요):**
- 배경을 구체적이고 풍부하게 묘사할 것 (단순 배경 금지)
- 분위기에 맞는 조명, 색감, 날씨, 시간대 포함
- 장면의 소품, 환경 요소 세세하게 묘사
- 귀엽고 코믹한 애니 느낌의 과장된 표현 활용
- ⛔ 글자/한국어/한자/일본어/간판 문구 절대 금지. 숫자나 영어 한두 글자는 허용 (예: "DEA", "88")
- 간판이나 포스터가 필요하면 문자 없이 그림/패턴으로만 표현할 것
좋은 예시: "capybara standing on a moonlit stage with dramatic spotlights, glittering star-shaped confetti raining down, crowd silhouettes below cheering, warm amber and purple stage lighting, decorative star-patterned banners on background walls, smoke machine fog at feet"
나쁜 예시: "capybara on a stage with Korean text signs"

**motionPrompt:** 카메라 움직임 + 캐릭터 행동 + 배경 움직임을 구체적으로 (영어)

JSON만 출력:
{"title":"...","characterStyle":"...","scenes":[{"text":"...","imagePrompt":"...","motionPrompt":"..."}]}`,
        }],
      });

      const rawText   = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('스크립트 파싱 실패');

      const raw = JSON.parse(jsonMatch[0]) as {
        title: string;
        characterStyle?: string;
        scenes: { text: string; imagePrompt: string; motionPrompt: string }[];
      };

      const scenes: Scene[] = raw.scenes.map((s, i) => ({
        id: `scene-${i}`, text: s.text,
        imagePrompt: s.imagePrompt, motionPrompt: s.motionPrompt,
        imageState: 'idle', videoState: 'idle',
      }));

      setScript({ title: raw.title, characterStyle: raw.characterStyle ?? '', scenes });
      setPhase('script-review');
    } catch (e: any) {
      setError(e.message ?? '스크립트 생성 실패');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Step 2: Generate images ─────────────────────────────────────────────────
  const generateImages = async () => {
    if (!script || isLoading) return;
    setIsLoading(true);
    setPhase('image-gen');
    setProgress(0);
    fal.config({ credentials: FAL_KEY });
    const imageSize = videoType === 'shorts' ? 'portrait_16_9' : 'landscape_16_9';

    for (let i = 0; i < script.scenes.length; i++) {
      setProgress(Math.round((i / script.scenes.length) * 100));
      setStatusMsg(`이미지 생성 중... (${i + 1}/${script.scenes.length})`);
      updateScene(i, { imageState: 'loading' });

      let success = false;
      for (let attempt = 0; attempt < 3 && !success; attempt++) {
        try {
          if (attempt > 0) await sleep(1500);
          const res = await fal.subscribe(MODEL_IMAGE, {
            input: {
              prompt: buildImagePrompt(script.scenes[i].imagePrompt, script.characterStyle),
              image_size: imageSize,
              num_images: 1,
              num_inference_steps: 4,
            },
          }) as any;
          const url = res?.data?.images?.[0]?.url as string | undefined;
          if (url) { updateScene(i, { imageUrl: url, imageState: 'done' }); success = true; }
        } catch (e) { console.error(`Image attempt ${attempt + 1}:`, e); }
      }
      if (!success) updateScene(i, { imageState: 'error' });
      await sleep(200);
    }

    setProgress(100);
    setIsLoading(false);
    setPhase('image-review');
  };

  // ── Regenerate single image ─────────────────────────────────────────────────
  const regenerateImage = async (idx: number) => {
    if (!script) return;
    updateScene(idx, { imageState: 'loading', imageUrl: undefined });
    fal.config({ credentials: FAL_KEY });
    const imageSize = videoType === 'shorts' ? 'portrait_16_9' : 'landscape_16_9';

    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      try {
        if (attempt > 0) await sleep(1500);
        const res = await fal.subscribe(MODEL_IMAGE, {
          input: {
            prompt: buildImagePrompt(script.scenes[idx].imagePrompt, script.characterStyle),
            image_size: imageSize, num_images: 1, num_inference_steps: 4,
          },
        }) as any;
        const url = res?.data?.images?.[0]?.url as string | undefined;
        if (url) { updateScene(idx, { imageUrl: url, imageState: 'done' }); success = true; }
      } catch (e) { console.error(`Regen attempt ${attempt + 1}:`, e); }
    }
    if (!success) updateScene(idx, { imageState: 'error' });
  };

  // ── Upload image ────────────────────────────────────────────────────────────
  const triggerUpload = (idx: number) => {
    setUploadingIdx(idx);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0];
    if (!file || uploadingIdx === null) return;
    const url = URL.createObjectURL(file);
    updateScene(uploadingIdx, { imageUrl: url, imageState: 'done' });
    setUploadingIdx(null);
    e.target.value = '';
  };

  // ── Step 3: Generate videos ─────────────────────────────────────────────────
  const generateVideos = async () => {
    if (!script || isLoading) return;
    setIsLoading(true);
    setPhase('video-gen');
    setProgress(0);
    fal.config({ credentials: FAL_KEY });
    const aspectRatio = videoType === 'shorts' ? '9:16' : '16:9';

    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      if (scene.imageState !== 'done') {
        updateScene(i, { videoState: 'error' });
        continue;
      }
      setProgress(Math.round((i / script.scenes.length) * 100));
      setStatusMsg(`동영상 생성 중... (${i + 1}/${script.scenes.length}) — 장면당 30초~2분 소요`);
      updateScene(i, { videoState: 'loading' });

      try {
        let imageUrl = scene.imageUrl!;
        if (!imageUrl.startsWith('http')) {
          const blob = await fetch(imageUrl).then(r => r.blob());
          imageUrl   = await fal.storage.upload(new File([blob], `scene-${i}.jpg`, { type: 'image/jpeg' }));
        }

        const result = await fal.subscribe(MODEL_VIDEO, {
          input: {
            prompt:       buildVideoPrompt(scene.motionPrompt || scene.imagePrompt, script.characterStyle),
            image_url:    imageUrl,
            duration:     '5',
            aspect_ratio: aspectRatio,
          } as any,
          pollInterval: 4_000,
        }) as any;

        const videoUri = result?.data?.video?.url as string | undefined;
        if (videoUri) {
          const blob = await fetch(videoUri).then(r => r.blob());
          updateScene(i, { videoUrl: URL.createObjectURL(blob), videoState: 'done' });
        } else {
          updateScene(i, { videoState: 'error' });
        }
      } catch (e: any) {
        console.error('Video error:', e);
        updateScene(i, { videoState: 'error' });
      }
      await sleep(300);
    }

    setProgress(100);
    setIsLoading(false);
    setPhase('done');
    setActiveIdx(0);
  };

  // ── Retry single video ──────────────────────────────────────────────────────
  const retryVideo = async (idx: number) => {
    if (!script) return;
    const scene       = script.scenes[idx];
    const aspectRatio = videoType === 'shorts' ? '9:16' : '16:9';
    updateScene(idx, { videoState: 'loading' });
    fal.config({ credentials: FAL_KEY });

    try {
      let imageUrl = scene.imageUrl!;
      if (!imageUrl.startsWith('http')) {
        const blob = await fetch(imageUrl).then(r => r.blob());
        imageUrl   = await fal.storage.upload(new File([blob], `scene-${idx}.jpg`, { type: 'image/jpeg' }));
      }
      const result = await fal.subscribe(MODEL_VIDEO, {
        input: { prompt: buildVideoPrompt(scene.motionPrompt || scene.imagePrompt, script.characterStyle), image_url: imageUrl, duration: '5', aspect_ratio: aspectRatio } as any,
        pollInterval: 4_000,
      }) as any;
      const videoUri = result?.data?.video?.url as string | undefined;
      if (videoUri) {
        const blob = await fetch(videoUri).then(r => r.blob());
        updateScene(idx, { videoUrl: URL.createObjectURL(blob), videoState: 'done' });
      } else updateScene(idx, { videoState: 'error' });
    } catch (e) { updateScene(idx, { videoState: 'error' }); }
  };

  // ── Merge videos ────────────────────────────────────────────────────────────
  const mergeVideos = async () => {
    if (!script || isMerging) return;
    const readyScenes = script.scenes.filter(s => s.videoUrl);
    if (readyScenes.length === 0) return;

    setIsMerging(true);
    setMergedVideoUrl(null);
    try {
      setMergeMsg('영상 크기 확인 중...');
      const firstVid = document.createElement('video');
      firstVid.src   = readyScenes[0].videoUrl!;
      firstVid.muted = true;
      await new Promise<void>(r => { firstVid.onloadedmetadata = () => r(); firstVid.load(); });

      const W = firstVid.videoWidth || 1080;
      const H = firstVid.videoHeight || 1920;
      const canvas  = document.createElement('canvas');
      canvas.width  = W; canvas.height = H;
      const ctx     = canvas.getContext('2d')!;
      const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
      const stream   = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.start(100);

      for (let i = 0; i < readyScenes.length; i++) {
        setMergeMsg(`합치는 중... (${i + 1}/${readyScenes.length})`);
        const vid = document.createElement('video');
        vid.src = readyScenes[i].videoUrl!; vid.muted = true;
        await new Promise<void>((resolve, reject) => {
          vid.onloadeddata = () => {
            vid.play().catch(reject);
            const draw = () => {
              if (vid.ended) { resolve(); return; }
              ctx.drawImage(vid, 0, 0, W, H);
              requestAnimationFrame(draw);
            };
            requestAnimationFrame(draw);
          };
          vid.onerror = () => reject(new Error(`영상 ${i + 1} 로드 실패`));
          vid.load();
        });
        await sleep(100);
      }

      recorder.stop();
      await new Promise<void>(r => { recorder.onstop = () => r(); });
      setMergedVideoUrl(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
      setMergeMsg('완성!');
    } catch (e: any) {
      setMergeMsg('실패: ' + (e.message ?? '오류'));
    } finally {
      setIsMerging(false);
    }
  };

  // ── Downloads ───────────────────────────────────────────────────────────────
  const downloadScene = (scene: Scene, idx: number) => {
    const url = scene.videoUrl ?? scene.imageUrl;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = `capyanime-${String(idx + 1).padStart(2, '0')}.${scene.videoUrl ? 'mp4' : 'jpg'}`;
    a.click();
  };

  const downloadAll = async () => {
    if (!script) return;
    for (let i = 0; i < script.scenes.length; i++) { downloadScene(script.scenes[i], i); await sleep(350); }
  };

  const downloadMerged = () => {
    if (!mergedVideoUrl) return;
    const a = document.createElement('a'); a.href = mergedVideoUrl; a.download = 'capyanime-merged.webm'; a.click();
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const scene      = script?.scenes[activeIdx];
  const videosDone = script?.scenes.filter(s => s.videoState === 'done').length ?? 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans pb-28">

      {/* Ambient glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-1/3 -left-1/4 w-3/4 h-3/4 bg-orange-500/5 blur-[200px] rounded-full" />
        <div className="absolute -bottom-1/3 -right-1/4 w-2/3 h-2/3 bg-violet-600/5 blur-[200px] rounded-full" />
      </div>

      {/* Hidden file input for image upload */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#080808]/85 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-[15px] tracking-tight">
              Capy<span className="text-orange-400">Anime</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Step indicator */}
            {phase !== 'input' && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-white/30">
                {(['script-review','image-gen','image-review','video-gen','done'] as AppPhase[]).map((p, i) => {
                  const labels = ['대본', '이미지생성', '이미지검토', '영상생성', '완료'];
                  const phaseOrder: AppPhase[] = ['input','script-review','image-gen','image-review','video-gen','done'];
                  const cur  = phaseOrder.indexOf(phase);
                  const this_ = phaseOrder.indexOf(p);
                  const done  = cur > this_;
                  const active = cur === this_;
                  return (
                    <span key={p} className={`flex items-center gap-1 ${active ? 'text-orange-400' : done ? 'text-emerald-400' : 'text-white/20'}`}>
                      {i > 0 && <ChevronRight className="w-3 h-3 opacity-40" />}
                      {done ? <CheckCircle2 className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {labels[i]}
                    </span>
                  );
                })}
              </div>
            )}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
              ANTHROPIC_KEY ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400' : 'border-red-500/20 bg-red-500/8 text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ANTHROPIC_KEY ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              {ANTHROPIC_KEY ? 'API 연결됨' : 'API 키 없음'}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-5 sm:px-8 py-10 space-y-10">

        {/* ══ INPUT PHASE ══ */}
        {phase === 'input' && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
            {/* Hero */}
            <section className="text-center space-y-5 pt-4">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/8 text-orange-400 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                Claude AI · fal.ai Flux · Kling v1.6
              </div>
              <h1 className="font-bold text-5xl sm:text-6xl md:text-7xl tracking-tight leading-[1.05]">
                카피바라 AI<br />
                <span className="bg-gradient-to-r from-orange-400 via-amber-400 to-orange-500 bg-clip-text text-transparent">영상 메이커</span>
              </h1>
              <p className="text-white/40 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
                주제 하나만 입력하면 — 대본 검토, 이미지 확인, 동영상까지<br />단계별로 직접 컨트롤하며 만들어요.
              </p>
            </section>

            {/* API warning */}
            {!ANTHROPIC_KEY && (
              <div className="max-w-xl mx-auto p-4 bg-amber-500/8 border border-amber-500/20 rounded-2xl flex gap-3 items-start">
                <Key className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-300">API 키 설정 필요</p>
                  <p className="text-xs text-amber-200/55">.env.local 에 ANTHROPIC_API_KEY 를 추가 후 재시작하세요.</p>
                </div>
              </div>
            )}

            {/* Controls */}
            <section className="max-w-xl mx-auto space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-white/30">영상 주제</label>
                <div className="relative group">
                  <input
                    type="text" value={topic} onChange={e => setTopic(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && generateScript()}
                    placeholder="예: 카피바라가 우주를 탐험하는 이야기"
                    disabled={isLoading}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-4 text-base placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-500/35 transition-all disabled:opacity-50"
                  />
                  <Wand2 className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/15 group-focus-within:text-orange-400/60 transition-colors" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-white/30">영상 형식</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { type: 'shorts' as const, Icon: Clock, label: '숏츠', sub: '세로 9:16 · 약 60초', color: 'orange' },
                    { type: 'longform' as const, Icon: Film, label: '롱폼', sub: '가로 16:9 · 약 5분', color: 'violet' },
                  ]).map(({ type, Icon, label, sub, color }) => {
                    const active = videoType === type;
                    return (
                      <button key={type} onClick={() => setVideoType(type)} disabled={isLoading}
                        className={`p-4 rounded-2xl border transition-all text-left disabled:opacity-50 ${active
                          ? color === 'orange' ? 'bg-orange-500/10 border-orange-500/40 text-orange-400' : 'bg-violet-500/10 border-violet-500/40 text-violet-400'
                          : 'bg-white/[0.03] border-white/[0.07] text-white/35 hover:bg-white/[0.05] hover:border-white/[0.12] hover:text-white/55'}`}>
                        <Icon className="w-5 h-5 mb-2.5" />
                        <div className="font-semibold text-sm">{label}</div>
                        <div className="text-xs opacity-50 mt-0.5">{sub}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button onClick={generateScript} disabled={!topic.trim() || isLoading || !ANTHROPIC_KEY}
                className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/15 hover:brightness-110 hover:scale-[1.015] active:scale-[0.99] transition-all disabled:opacity-35 disabled:hover:scale-100 disabled:hover:brightness-100 disabled:shadow-none flex items-center justify-center gap-2.5">
                {isLoading ? <><Loader2 className="w-5 h-5 animate-spin" />대본 작성 중...</> : <><Sparkles className="w-5 h-5" />대본 생성하기</>}
              </button>

              {error && (
                <div className="p-4 bg-red-500/8 border border-red-500/20 rounded-2xl flex gap-3 items-start text-red-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </section>
          </motion.div>
        )}

        {/* ══ SCRIPT REVIEW ══ */}
        {phase === 'script-review' && script && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1">1단계 — 대본 검토 및 수정</p>
                <h2 className="font-bold text-xl sm:text-2xl">{script.title}</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={resetAll} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/40 bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-all">
                  <RotateCcw className="w-3.5 h-3.5" />처음으로
                </button>
                <button onClick={generateImages} disabled={isLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20 hover:brightness-110 transition-all disabled:opacity-40">
                  <ImageIcon className="w-4 h-4" />이미지 생성 시작
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-white/35 flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5" />
              나레이션과 이미지 프롬프트를 직접 수정할 수 있어요. 수정 후 이미지 생성을 시작하세요.
            </p>

            {/* Character Style */}
            <div className="bg-orange-500/6 border border-orange-500/20 rounded-2xl p-4 space-y-2">
              <label className="text-[11px] font-semibold text-orange-400/70 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />캐릭터 스타일 (전체 영상 공통)
              </label>
              <textarea
                value={script.characterStyle ?? ''}
                onChange={e => setScript(prev => prev ? { ...prev, characterStyle: e.target.value } : prev)}
                rows={2}
                placeholder="주제에 맞는 의상/소품/헤어 스타일... (비워두면 기본 카피바라)"
                className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-sm text-orange-200/60 font-mono text-xs placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-orange-500/30 resize-none transition-all"
              />
            </div>

            <div className="space-y-3">
              {script.scenes.map((sc, i) => (
                <div key={sc.id} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 text-[11px] font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[11px] font-semibold text-white/30 uppercase tracking-widest">장면 {i + 1}</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">나레이션</label>
                    <textarea
                      value={sc.text}
                      onChange={e => updateScene(i, { text: e.target.value })}
                      rows={2}
                      className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/30 resize-none transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">이미지 프롬프트</label>
                    <textarea
                      value={sc.imagePrompt}
                      onChange={e => updateScene(i, { imagePrompt: e.target.value })}
                      rows={2}
                      className="w-full bg-white/[0.04] border border-white/[0.07] rounded-xl px-3.5 py-2.5 text-sm text-white/50 font-mono text-xs placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/30 resize-none transition-all"
                    />
                  </div>
                </div>
              ))}
            </div>

            <button onClick={generateImages} disabled={isLoading}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/15 hover:brightness-110 hover:scale-[1.015] active:scale-[0.99] transition-all disabled:opacity-35 flex items-center justify-center gap-2.5">
              <ImageIcon className="w-5 h-5" />{script.scenes.length}개 장면 이미지 생성 시작
            </button>
          </motion.div>
        )}

        {/* ══ IMAGE GENERATING ══ */}
        {phase === 'image-gen' && script && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1">2단계 — 이미지 생성 중</p>
              <h2 className="font-bold text-xl">{script.title}</h2>
            </div>

            <div className="max-w-md mx-auto space-y-3 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50">{statusMsg}</span>
                <span className="font-bold text-orange-400">{progress}%</span>
              </div>
              <div className="h-2 bg-white/[0.07] rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full"
                  animate={{ width: `${progress}%` }} transition={{ ease: 'easeOut', duration: 0.5 }} />
              </div>
            </div>

            {/* Image grid preview while generating */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {script.scenes.map((sc, i) => (
                <div key={sc.id} className={`aspect-[${videoType === 'shorts' ? '9/16' : '16/9'}] rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.03] flex items-center justify-center relative`}
                  style={{ aspectRatio: videoType === 'shorts' ? '9/16' : '16/9' }}>
                  {sc.imageUrl
                    ? <img src={sc.imageUrl} className="w-full h-full object-cover" alt="" />
                    : sc.imageState === 'loading'
                      ? <Loader2 className="w-6 h-6 animate-spin text-orange-400/60" />
                      : <ImageIcon className="w-6 h-6 text-white/10" />
                  }
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/60 text-[10px] font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ══ IMAGE REVIEW ══ */}
        {phase === 'image-review' && script && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1">2단계 — 이미지 검토</p>
                <h2 className="font-bold text-xl sm:text-2xl">{script.title}</h2>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPhase('script-review')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/40 bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-all">
                  <ChevronLeft className="w-3.5 h-3.5" />대본 수정
                </button>
                <button onClick={generateVideos} disabled={isLoading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg shadow-orange-500/20 hover:brightness-110 transition-all disabled:opacity-40">
                  <Video className="w-4 h-4" />영상 생성 시작
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-white/35 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              마음에 안 드는 이미지는 재생성하거나 직접 업로드할 수 있어요.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {script.scenes.map((sc, i) => (
                <div key={sc.id} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden">
                  {/* Image */}
                  <div className="relative bg-black" style={{ aspectRatio: videoType === 'shorts' ? '9/16' : '16/9' }}>
                    {sc.imageUrl
                      ? <img src={sc.imageUrl} className="w-full h-full object-cover" alt="" />
                      : <div className="w-full h-full flex items-center justify-center">
                          {sc.imageState === 'loading'
                            ? <Loader2 className="w-8 h-8 animate-spin text-orange-400/60" />
                            : <div className="text-center space-y-2">
                                <ImageIcon className="w-8 h-8 text-white/10 mx-auto" />
                                <p className="text-xs text-red-400">생성 실패</p>
                              </div>
                          }
                        </div>
                    }
                    <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/70 text-[11px] font-bold flex items-center justify-center">
                      {i + 1}
                    </div>
                    {sc.imageState === 'loading' && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                      </div>
                    )}
                  </div>

                  {/* Info & actions */}
                  <div className="p-3 space-y-2.5">
                    {/* 한국어 나레이션 */}
                    <p className="text-xs text-white/60 leading-relaxed border-b border-white/[0.06] pb-2">{sc.text}</p>
                    {/* 이미지 프롬프트 편집 */}
                    <textarea
                      value={sc.imagePrompt}
                      onChange={e => updateScene(i, { imagePrompt: e.target.value })}
                      rows={2}
                      className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-2.5 py-2 text-[11px] text-white/35 font-mono placeholder:text-white/15 focus:outline-none focus:ring-1 focus:ring-orange-500/25 focus:text-white/55 resize-none transition-all"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => regenerateImage(i)} disabled={sc.imageState === 'loading'}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40 transition-all">
                        <RefreshCw className="w-3 h-3" />재생성
                      </button>
                      <button onClick={() => triggerUpload(i)} disabled={sc.imageState === 'loading'}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40 transition-all">
                        <Upload className="w-3 h-3" />업로드
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={generateVideos} disabled={isLoading}
              className="w-full py-4 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/15 hover:brightness-110 hover:scale-[1.015] active:scale-[0.99] transition-all disabled:opacity-35 flex items-center justify-center gap-2.5">
              <Video className="w-5 h-5" />{script.scenes.length}개 장면 영상 생성 시작
            </button>
          </motion.div>
        )}

        {/* ══ VIDEO GENERATING ══ */}
        {phase === 'video-gen' && script && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1">3단계 — 동영상 생성 중</p>
              <h2 className="font-bold text-xl">{script.title}</h2>
            </div>

            <div className="max-w-md mx-auto space-y-3 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/50">{statusMsg}</span>
                <span className="font-bold text-orange-400">{progress}%</span>
              </div>
              <div className="h-2 bg-white/[0.07] rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full"
                  animate={{ width: `${progress}%` }} transition={{ ease: 'easeOut', duration: 0.5 }} />
              </div>
              <p className="text-xs text-white/25 text-center">장면당 30초~2분 소요돼요. 잠시 기다려주세요.</p>
            </div>

            {/* Video grid preview */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {script.scenes.map((sc, i) => (
                <div key={sc.id} className="rounded-2xl overflow-hidden border border-white/[0.07] bg-black relative"
                  style={{ aspectRatio: videoType === 'shorts' ? '9/16' : '16/9' }}>
                  {sc.videoUrl
                    ? <video src={sc.videoUrl} autoPlay loop muted className="w-full h-full object-cover" />
                    : sc.imageUrl
                      ? <img src={sc.imageUrl} className="w-full h-full object-cover opacity-40" alt="" />
                      : null
                  }
                  <div className={`absolute inset-0 flex items-center justify-center ${sc.videoState === 'done' ? 'hidden' : ''}`}>
                    {sc.videoState === 'loading'
                      ? <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
                      : sc.videoState === 'error'
                        ? <AlertCircle className="w-5 h-5 text-red-400" />
                        : <Clock className="w-5 h-5 text-white/20" />
                    }
                  </div>
                  <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-black/60 text-[10px] font-bold flex items-center justify-center">{i + 1}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ══ DONE ══ */}
        {phase === 'done' && script && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            {/* Header */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-white/25 mb-1.5">완성된 영상</p>
                <h2 className="font-bold text-xl sm:text-2xl">{script.title}</h2>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={resetAll}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white/40 bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-all">
                  <RotateCcw className="w-3.5 h-3.5" />처음으로
                </button>
                <button onClick={downloadAll}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-all">
                  <Download className="w-3.5 h-3.5" />전체 다운로드
                </button>
                <button onClick={mergeVideos} disabled={isMerging || videosDone === 0}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-violet-500/10 border border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-40">
                  {isMerging ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />합치는 중...</> : <><Merge className="w-3.5 h-3.5" />영상 합치기 ({videosDone}개)</>}
                </button>
                {mergedVideoUrl && (
                  <motion.button initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    onClick={downloadMerged}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all">
                    <Download className="w-3.5 h-3.5" />합친 영상 다운로드
                  </motion.button>
                )}
              </div>
            </div>

            {/* Merge status */}
            <AnimatePresence>
              {(isMerging || mergedVideoUrl || (mergeMsg && mergeMsg !== '완성!')) && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="p-4 bg-violet-500/8 border border-violet-500/20 rounded-2xl space-y-3">
                  {isMerging && <p className="text-sm text-violet-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{mergeMsg}</p>}
                  {mergedVideoUrl && !isMerging && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />합치기 완료!</p>
                      <video src={mergedVideoUrl} controls className="w-full max-w-lg rounded-xl border border-white/[0.07]" />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main viewer */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
              <div className="xl:col-span-2 space-y-4">
                <div className={`relative bg-black rounded-3xl overflow-hidden border border-white/[0.07] shadow-2xl ${videoType === 'shorts' ? 'aspect-[9/16] max-w-[300px] mx-auto xl:mx-0' : 'aspect-video'}`}>
                  <AnimatePresence mode="wait">
                    {scene && (
                      <motion.div key={activeIdx} initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0">
                        {scene.videoUrl
                          ? <video src={scene.videoUrl} autoPlay loop muted className="w-full h-full object-cover" />
                          : scene.imageUrl
                            ? <img src={scene.imageUrl} className="w-full h-full object-cover" alt="" />
                            : <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white/20" /></div>
                        }
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="absolute bottom-0 inset-x-0 p-3.5 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setActiveIdx(i => Math.max(0, i - 1))} disabled={activeIdx === 0}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button onClick={() => setIsPlaying(p => !p)}
                        className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-400 flex items-center justify-center transition-all shadow-lg shadow-orange-500/30">
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>
                      <button onClick={() => setActiveIdx(i => Math.min((script?.scenes.length ?? 1) - 1, i + 1))}
                        disabled={activeIdx === (script?.scenes.length ?? 1) - 1}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-white/40 font-medium tabular-nums">{activeIdx + 1} / {script.scenes.length}</span>
                      <button onClick={() => scene && downloadScene(scene, activeIdx)} disabled={!scene?.imageUrl && !scene?.videoUrl}
                        className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center disabled:opacity-25 transition-all">
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-white/[0.03] border border-white/[0.07] rounded-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-white/25 mb-2">나레이션</p>
                  <p className="text-sm text-white/70 leading-relaxed">{scene?.text}</p>
                </div>

                {scene && (
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { label: '이미지', state: scene.imageState, Icon: ImageIcon },
                      { label: '영상', state: scene.videoState, Icon: Video,
                        onRetry: scene.videoState === 'error' ? () => retryVideo(activeIdx) : undefined },
                    ]).map(({ label, state, Icon, onRetry }) => (
                      <div key={label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        state === 'done' ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400' :
                        state === 'loading' ? 'bg-orange-500/8 border-orange-500/20 text-orange-400' :
                        state === 'error' ? 'bg-red-500/8 border-red-500/20 text-red-400' :
                        'bg-white/[0.04] border-white/[0.07] text-white/25'}`}>
                        <Icon className="w-3 h-3" />{label}
                        {state === 'loading' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                        {state === 'done' && <CheckCircle2 className="w-2.5 h-2.5" />}
                        {onRetry && <button onClick={onRetry} className="ml-0.5 hover:opacity-70"><RefreshCw className="w-2.5 h-2.5" /></button>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Scene list */}
              <div className="space-y-2 max-h-[680px] overflow-y-auto scrollbar-thin pr-0.5">
                {script.scenes.map((sc, i) => (
                  <motion.button key={sc.id} onClick={() => { setActiveIdx(i); setIsPlaying(false); }}
                    whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                    className={`w-full flex gap-3 p-3 rounded-2xl border text-left transition-all ${i === activeIdx ? 'bg-orange-500/10 border-orange-500/30' : 'bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.045] hover:border-white/10'}`}>
                    <div className="relative w-[52px] h-[52px] rounded-xl overflow-hidden bg-white/[0.05] flex-shrink-0">
                      {sc.imageUrl ? <img src={sc.imageUrl} className="w-full h-full object-cover" alt="" />
                        : <div className="w-full h-full flex items-center justify-center">
                            {sc.imageState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/30" /> : <ImageIcon className="w-3.5 h-3.5 text-white/15" />}
                          </div>}
                      {sc.videoState === 'done' && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Video className="w-3 h-3 text-orange-400" /></div>}
                    </div>
                    <div className="flex-1 min-w-0 py-0.5 space-y-1.5">
                      <p className={`text-[11px] font-semibold ${i === activeIdx ? 'text-orange-400' : 'text-white/30'}`}>장면 {i + 1}</p>
                      <p className="text-[11px] text-white/45 leading-relaxed line-clamp-2">{sc.text}</p>
                      <div className="flex gap-1">
                        {([sc.imageState, sc.videoState] as AssetState[]).map((st, si) => (
                          <span key={si} className={`w-1.5 h-1.5 rounded-full ${st === 'done' ? 'bg-emerald-400' : st === 'loading' ? 'bg-orange-400 animate-pulse' : st === 'error' ? 'bg-red-400' : 'bg-white/15'}`} />
                        ))}
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.05] mt-10 py-6 text-center">
        <p className="text-white/20 text-xs">Capy Anime Creator · Claude AI · fal.ai Flux &amp; Kling v1.6</p>
      </footer>

      {/* ── Loading overlay for image/video gen ── */}
      <AnimatePresence>
        {isLoading && (phase === 'image-gen' || phase === 'video-gen') && (
          <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-0 inset-x-0 z-50 p-4 pb-5 bg-[#0d0d0d]/95 border-t border-white/[0.08] backdrop-blur-xl">
            <div className="max-w-2xl mx-auto space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/50 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-400" />{statusMsg}
                </span>
                <span className="font-bold text-orange-400">{progress}%</span>
              </div>
              <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full"
                  animate={{ width: `${progress}%` }} transition={{ ease: 'easeOut', duration: 0.5 }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
