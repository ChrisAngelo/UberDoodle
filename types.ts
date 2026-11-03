

export interface Scene {
  id: string;
  type?: 'standard' | 'video'; // New: Support for Video Scenes
  number: number;
  script: string;
  visualDescription: string;
  visualKeywords?: string; 
  imageUrl?: string; 
  isDisabled?: boolean; // New: Disable card from preview/export
  
  // Video Properties
  videoUrl?: string; // Object URL for video file
  videoDuration?: number; // Total length in seconds
  videoMediaStart?: number; // Trim Start in seconds (New)
  videoMediaEnd?: number; // Trim End in seconds (New)
  videoVolume?: number; // 0.0 to 1.0
  
  // Legacy / Audio Properties
  mediaStart?: number; // Audio/Narration Start Offset
  mediaEnd?: number; // Audio/Narration End Offset

  // Veo Generation Config
  videoGenerationConfig?: {
      model: VeoModel;
      prompt: string;
      durationSeconds: number; // Veo 3 supports: 4, 6, or 8 seconds (default: 8)
      inputImageUrl?: string; // NEW: Source image for Image-to-Video
  };

  audioUrl?: string; 
  sfxUrl?: string; 
  sfxVolume?: number; 
  isGenerating: boolean;
  handId?: string; 
  customPace?: number; 
  customWobble?: number; 
  isLocked?: boolean; 
  originalScript?: string; 
  originalVisualDescription?: string; 
  
  // Background Properties
  backgroundUrl?: string; // Local override for background image
  enableGlobalBackground?: boolean; // Defaults to true
  
  // Blend Mode for Dark/Light styles
  layerBlendMode?: 'multiply' | 'screen' | 'normal';
}

export type VeoModel = 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview';

export type ArtStyle = 
  | 'Nano Banana 2.5' 
  | 'Standard Sketch' 
  | 'Charcoal Pencil'
  | 'Charcoal Pencil (Color Splash)'
  | 'Custom'
  | 'Apocalypse'
  | 'Apocalypse (Color Splash)'
  | 'Tin-Tin' 
  | 'Fallout' 
  | 'Stickman' 
  | 'Papercut'
  | 'Springfield Flat'
  // Inverted / Dark Mode Variants
  | 'Nano Banana 2.5 (Inverted)'
  | 'Standard Sketch (Inverted)'
  | 'Charcoal Pencil (Inverted)'
  | 'Charcoal Pencil (Color Splash) (Inverted)'
  | 'Apocalypse (Inverted)'
  | 'Apocalypse (Color Splash) (Inverted)'
  | 'Stickman (Inverted)';

export type BrushStyle = 'Solid Marker' | 'Textured Pencil';
export type RevealStyle = 'Standard Pencil' | 'Grunge Scrawl' | 'Watercolor Flow' | 'Marker Bold';
export type RevealDirection = 'TopDown' | 'LeftRight' | 'Diagonal' | 'CenterOut';

export type VoiceProvider = 'Google' | 'LMNT' | 'ElevenLabs' | 'GenAiPro';

export interface VoiceOption {
    id: string;
    label: string;
    gender: 'Male' | 'Female';
    desc: string;
    provider: VoiceProvider;
    previewUrl?: string; // For GenAiPro samples
    tags?: any; // Extra metadata
}

// GenAiPro Specific Configuration
export interface GenAiProConfig {
    model_id: 'eleven_multilingual_v2' | 'eleven_turbo_v2_5' | 'eleven_flash_v2_5' | 'eleven_v3';
    stability: number; // 0.0 - 1.0
    similarity_boost: number; // 0.0 - 1.0
    style: number; // 0.0 - 1.0
    use_speaker_boost: boolean;
    speed?: number; // Added speed property
}

export const NARRATION_STYLES = [
    "Storytelling (Default)",
    "Documentary / Facts",
    "Funny / Comedic",
    "Energetic / Hype",
    "Whispering / ASMR",
    "Angry / Intense",
    "Professional News",
    "Cheerful / Happy",
    "Sad / Somber",
    "Educational / Instructional",
    "Meditative / Calm",
    "Custom..."
];

// BEGIN_PROTECTED
export const TTS_VOICES: VoiceOption[] = [
    // GenAiPro (Labs)
    { id: 'ZMs9a3j1SLzirC7aygJQ', label: 'Kim - Svenska', gender: 'Male', desc: 'Social Media', provider: 'GenAiPro' },

    // Google Voices - Male (Validated List)
    { id: 'Puck', label: 'Puck', gender: 'Male', desc: 'Playful & Energetic', provider: 'Google' },
    { id: 'Charon', label: 'Charon', gender: 'Male', desc: 'Deep & Authoritative', provider: 'Google' },
    { id: 'Fenrir', label: 'Fenrir', gender: 'Male', desc: 'Intense & Strong', provider: 'Google' },
    { id: 'Zephyr', label: 'Zephyr', gender: 'Male', desc: 'Calm & Balanced', provider: 'Google' },
    { id: 'Orus', label: 'Orus', gender: 'Male', desc: 'Soft & Trustworthy', provider: 'Google' },
    { id: 'Iapetus', label: 'Iapetus', gender: 'Male', desc: 'Deep & Resonant', provider: 'Google' },
    { id: 'Enceladus', label: 'Enceladus', gender: 'Male', desc: 'Grounded & direct', provider: 'Google' },
    
    // Google Voices - Female (Validated List)
    { id: 'Kore', label: 'Kore', gender: 'Female', desc: 'Soothing & Calm', provider: 'Google' },
    { id: 'Aoede', label: 'Aoede', gender: 'Female', desc: 'Expressive & Dynamic', provider: 'Google' },
    { id: 'Erinome', label: 'Erinome', gender: 'Female', desc: 'Smooth & Professional', provider: 'Google' },
    
    // LMNT Voices (Premium)
    { id: 'ecccd025-04e1-4382-9271-a2fe31432891', label: 'Harrison', gender: 'Male', desc: 'Calm Narration (Premium)', provider: 'LMNT' },
    { id: '462e2487-0af4-4eca-8a8b-7e9064810542', label: 'DoodleMinds', gender: 'Male', desc: 'Signature Narrator', provider: 'LMNT' },
    { id: '52d72957-f745-4ffb-b5bc-244d0f10ab4d', label: 'Maya', gender: 'Female', desc: 'Warm & Professional', provider: 'LMNT' },
    { id: '36d4d99e-dd7a-4caf-9329-7c9aa3b2b3af', label: 'Aussie', gender: 'Male', desc: 'Australian Accent', provider: 'LMNT' },
];
// END_PROTECTED

export const LANGUAGES = [
    'English (US)', 
    'English (UK)', 
    'English (Australia)', 
    'Spanish (Castilian)', 
    'French', 
    'German', 
    'Italian', 
    'Japanese', 
    'Korean', 
    'Chinese (Simplified)', 
    'Portuguese',
    'Swedish',
    'Thai',
    'Russian',
    'Czech'
];

export type VoiceName = string;

export type AspectRatio = '16:9' | '9:16';
export type Resolution = '720p' | '1080p';
export type TargetDuration = 6 | 12 | 24 | 'Fast';
export type TotalLength = 5 | 8 | 12 | 15 | 20 | 30;

export type HandCategory = 'Male' | 'Female' | 'Tool' | 'Custom' | 'None';

export interface HandOption {
  id: string;
  name: string;
  category: HandCategory;
  src: string;
  srcClosed?: string; // For tools like scissors
  isCustom?: boolean;
  tipOffset?: { x: number; y: number }; // 0-1 coordinates relative to image size
  scale?: number; // Scale factor (default 1.0)
  isDisabled?: boolean; // New: Soft delete state
}

export interface BackgroundOption {
    id: string;
    name: string;
    src: string;
    isDisabled?: boolean; // New: Soft delete state
}

export interface ExportOptions {
    includeVideo: boolean;
    includeNarration: boolean;
    includeSfx: boolean;
    includeMusic: boolean;
    includeCaptions: boolean;
}

export type ThumbnailStyle = 
    | 'MrBeast' 
    | 'Minimalist' 
    | 'Shocking' 
    | 'Versus' 
    | 'Story' 
    | 'Charcoal Pencil' 
    | 'Custom' 
    | 'Sketch A' 
    | 'Psychology'
    | 'Charcoal Pencil (Color Splash)'
    | 'Apocalypse (Color Splash)'
    | 'Standard Sketch'
    | 'Springfield Flat';

export interface Thumbnail {
    id: string;
    imageUrl: string;
    promptUsed: string;
    style: ThumbnailStyle;
}

// v22.7 Framework Types
export interface TitleVariant {
    title: string;
    formula_used: string;
    score: number;
    reasoning: string;
}

export interface TitleGenerationResult {
    primary_title: string;
    alternative_titles: TitleVariant[];
    seo_keywords_extracted: string[];
    estimated_ctr_potential: 'low' | 'medium' | 'high' | 'very_high';
}

export interface DescriptionComponentBreakdown {
    opening_hook: string;
    value_proposition: string;
    content_bullets: string[];
    credibility_statement: string;
    cta: string;
    keywords: string[];
    engagement_prompt: string;
    disclaimer: string;
    hashtags: string[];
    business_email: string;
}

export interface DescriptionGenerationResult {
    full_description: string;
    component_breakdown: DescriptionComponentBreakdown;
    character_count: number;
    seo_score: number;
    readability_grade: string;
}

export interface ProjectState {
  topic: string;
  niche: 'Survival' | 'What If' | 'Psychology' | 'Education' | 'Business' | 'Storytelling' | 'Finance' | 'Elderly Advice';
  targetDuration: TargetDuration; // Scene pacing
  totalDurationMinutes?: TotalLength; // NEW: Global video length preference
  script: string;
  scriptLanguage?: string; // New: Selected Generation Language
  scenes: Scene[];
  currentStep: 'script' | 'storyboard' | 'preview' | 'thumbnails';
  isProcessing: boolean;
  artStyle: ArtStyle;
  brushStyle: BrushStyle;
  revealStyle: RevealStyle;
  revealDirection?: RevealDirection;
  spreadLevel: number; // 0 to 100
  drawingPace: number; // 0.5 to 2.0
  textFirst?: boolean; // Render text at top first
  outlinesFirst?: boolean; // Render dark outlines before colors
  
  // VOICE CONFIG
  voice: VoiceName; // Holds the ID
  voiceProvider: VoiceProvider; // New: Tracks which service to use
  voiceLabel?: string; // New: Persist human-readable voice name
  genAiProConfig?: GenAiProConfig; // New: Advanced settings for GenAiPro
  
  narrationStyle?: string; // New: Affects TTS Render (Google mainly)
  targetLanguage?: string; // Translation language
  showHand: boolean;
  selectedHandId: string;
  customHands: HandOption[];
  
  // Background Assets
  customBackgrounds: BackgroundOption[];
  selectedBackgroundId: string | null;

  aspectRatio: AspectRatio;
  exportResolution: Resolution;
  analyzedStylePrompt?: string; // Custom style from image analysis
  colorSplash?: string; // NEW: Color Splash Preference
  
  suggestedHooks?: string[]; 
  
  // v22.7 Enterprise Data
  titleData?: TitleGenerationResult; 
  descriptionData?: DescriptionGenerationResult;
  
  // Navigation State
  jumpToSceneOnMount?: number; // Scene Number to scroll to when entering Storyboard

  isOfflineRender?: boolean; // NEW: Force fixed-step rendering
  isAutoExporting?: boolean;
  shouldAutoPlay?: boolean; // NEW: Trigger Playback on mount
  useGPU?: boolean; // GPU Acceleration Preference
  globalSfxUrl?: string; // Global drawing sound
  musicUrl?: string; // Background Music
  
  // Audio Mastering
  masterVolume: number; // Global Output 0.0 - 1.0
  narrationMasterVolume: number; // Voice Sub-master 0.0 - 1.0
  sfxMasterVolume: number; // SFX Sub-master 0.0 - 1.0
  musicVolume: number; // Music Sub-master 0.0 - 1.0

  // Export Settings
  exportStartScene?: number;
  exportEndScene?: number;
  exportOptions?: ExportOptions; // Checkbox states
  
  // Visual Settings
  showCaptions: boolean; // CC Toggle
  
  // Assets
  thumbnails: Thumbnail[];
}

export enum GenerationType {
  SCRIPT = 'SCRIPT',
  IMAGE_NEW = 'IMAGE_NEW',
  IMAGE_EDIT = 'IMAGE_EDIT',
  AUDIO = 'AUDIO'
}

export interface GeminiError {
  message: string;
}