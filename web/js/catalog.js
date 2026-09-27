/* ==========================================================================
   catalog.js —— 器材数据库
   机身 / 镜头 / 光圈 / 快门 / 胶片 / 滤镜 / 闪光
   每条都带 promptToken：这是「提示词工程」的原料，engine.js 负责组装。
   ========================================================================== */
window.CATALOG = (function () {
  'use strict';

  /* ------------------------------------------------------------------ 机身 */
  // format: 画幅 -> 决定弥散圈 c、视角系数、画幅比例
  // c: 弥散圈直径 (mm)；sensorW: 感光面宽 (mm)
  const FORMATS = {
    'ff':      { label: '全画幅 36×24',  c: 0.029, sensorW: 36,   ratio: 3 / 2 },
    'apsc':    { label: 'APS-C 23.5×15.6', c: 0.019, sensorW: 23.5, ratio: 3 / 2 },
    'mft':     { label: 'M4/3 17.3×13',  c: 0.015, sensorW: 17.3, ratio: 4 / 3 },
    'mf44':    { label: '中画幅 44×33',   c: 0.037, sensorW: 44,   ratio: 4 / 3 },
    'mf66':    { label: '中画幅 6×6',     c: 0.053, sensorW: 56,   ratio: 1 },
    'mf67':    { label: '中画幅 6×7',     c: 0.059, sensorW: 70,   ratio: 7 / 6 },
    'lf45':    { label: '大画幅 4×5',     c: 0.100, sensorW: 102,  ratio: 5 / 4 },
    'phone':   { label: '手机 1/1.3"',    c: 0.007, sensorW: 9.8,  ratio: 4 / 3 }
  };

  // grip: 机身造型，用于 SVG 绘制。slr / rangefinder / tlr / field / view / compact / phone / instant
  const BODIES = [
    { id: 'a7rv', name: 'Sony α7R V', cn: '索尼 A7R V', grip: 'mirrorless', format: 'ff',
      kind: 'digital', gen: 'modern', maxIso: 32000, baseIso: 100, minShutter: 1 / 8000, maxShutter: 30,
      token: 'shot on a Sony α7R V full-frame mirrorless camera, 61 megapixel, extremely clean digital detail',
      trait: '6100 万像素，细节极致，宽容度高' },

    { id: 'r5', name: 'Canon EOS R5', cn: '佳能 EOS R5', grip: 'mirrorless', format: 'ff',
      kind: 'digital', gen: 'modern', maxIso: 51200, baseIso: 100, minShutter: 1 / 8000, maxShutter: 30,
      token: 'shot on a Canon EOS R5 full-frame mirrorless, Canon colour science, clean modern digital rendering',
      trait: '佳能色彩科学，人像肤色讨喜' },

    { id: 'z9', name: 'Nikon Z9', cn: '尼康 Z9', grip: 'mirrorless', format: 'ff',
      kind: 'digital', gen: 'modern', maxIso: 102400, baseIso: 64, minShutter: 1 / 32000, maxShutter: 900,
      token: 'shot on a Nikon Z9 flagship full-frame mirrorless, crisp neutral rendering, esports-grade high-speed capture',
      trait: '旗舰速度机，1/32000 快门，可拍极高速瞬间' },

    { id: 'd850', name: 'Nikon D850', cn: '尼康 D850', grip: 'slr', format: 'ff',
      kind: 'digital', gen: 'dslr', maxIso: 25600, baseIso: 64, minShutter: 1 / 8000, maxShutter: 30,
      token: 'shot on a Nikon D850 DSLR, optical viewfinder framing, high dynamic range digital file',
      trait: '末代单反机皇，光学取景，宽容度高' },

    { id: '5d4', name: 'Canon EOS 5D Mark IV', cn: '佳能 5D4', grip: 'slr', format: 'ff',
      kind: 'digital', gen: 'dslr', maxIso: 32000, baseIso: 100, minShutter: 1 / 8000, maxShutter: 30,
      token: 'shot on a Canon EOS 5D Mark IV DSLR, moderate dynamic range, classic wedding-photographer look',
      trait: '婚礼/人像经典机身' },

    { id: 'x2d', name: 'Hasselblad X2D 100C', cn: '哈苏 X2D', grip: 'mirrorless', format: 'mf44',
      kind: 'digital', gen: 'modern', maxIso: 25600, baseIso: 64, minShutter: 1 / 4000, maxShutter: 68,
      token: 'shot on a Hasselblad X2D 100C medium format digital camera, Hasselblad natural colour solution, enormous tonal depth and micro-contrast',
      trait: '中画幅数码，层次与微反差极致' },

    { id: 'fm2', name: 'Nikon FM2', cn: '尼康 FM2', grip: 'slr', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 6400, baseIso: 100, minShutter: 1 / 4000, maxShutter: 1,
      manual: true, advance: 'lever',
      token: 'shot on a Nikon FM2 35mm film SLR with a Nikkor lens, mechanical film camera, hand-framed',
      trait: '全机械 35mm 单反，手动过片' },

    { id: 'ae1', name: 'Canon AE-1', cn: '佳能 AE-1', grip: 'slr', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 3200, baseIso: 100, minShutter: 1 / 1000, maxShutter: 2,
      manual: true, advance: 'lever',
      token: 'shot on a Canon AE-1 35mm film SLR, 1970s Japanese film camera, slight vignetting from an old FD lens',
      trait: '70 年代机身，FD 卡口老镜头味道' },

    { id: 'k1000', name: 'Pentax K1000', cn: '宾得 K1000', grip: 'slr', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 1600, baseIso: 100, minShutter: 1 / 1000, maxShutter: 1,
      manual: true, advance: 'lever',
      token: 'shot on a Pentax K1000 35mm film SLR, the classic student camera, simple honest rendering',
      trait: '教材里的学生机，朴素诚实' },

    { id: 'm6', name: 'Leica M6', cn: '徕卡 M6', grip: 'rangefinder', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 3200, baseIso: 100, minShutter: 1 / 1000, maxShutter: 1,
      manual: true, advance: 'lever',
      token: 'shot on a Leica M6 35mm rangefinder with a Summicron lens, Leica glow and micro-contrast, discreet documentary framing',
      trait: '旁轴取景，街拍之王，徕卡味' },

    { id: 'm3', name: 'Leica M3', cn: '徕卡 M3', grip: 'rangefinder', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 1600, baseIso: 100, minShutter: 1 / 1000, maxShutter: 1,
      manual: true, advance: 'lever', bwBias: 0.25,
      token: 'shot on a Leica M3 with a 50mm Summicron, 1950s black and white documentary photography',
      trait: '1954 年旁轴经典，黑白纪实之魂' },

    { id: 'rb67', name: 'Mamiya RB67', cn: '玛米亚 RB67', grip: 'slr', format: 'mf67',
      kind: 'film', gen: 'vintage', maxIso: 1600, baseIso: 100, minShutter: 1 / 400, maxShutter: 1,
      manual: true, advance: 'lever', bellows: true,
      token: 'shot on a Mamiya RB67 medium format 6x7 film camera, huge 6x7 negative, incredible tonality',
      trait: '6×7 中画幅，皮腔对焦，画面扎实' },

    { id: 'rollei', name: 'Rolleiflex 2.8F', cn: '禄来 2.8F 双反', grip: 'tlr', format: 'mf66',
      kind: 'film', gen: 'vintage', maxIso: 1600, baseIso: 100, minShutter: 1 / 500, maxShutter: 1,
      manual: true, advance: 'crank', waistLevel: true,
      token: 'shot on a Rolleiflex 2.8F twin-lens reflex, waist-level finder viewpoint, square 6x6 framing, Planar lens rendering',
      trait: '双反腰平取景，正方形构图' },

    { id: 'sinar', name: 'Sinar F2 4×5', cn: '仙娜 4×5 座机', grip: 'view', format: 'lf45',
      kind: 'film', gen: 'vintage', maxIso: 400, baseIso: 100, minShutter: 1 / 400, maxShutter: 60,
      manual: true, advance: 'dark-slide', movements: true, bellows: true,
      token: 'shot on a Sinar F2 4x5 large format view camera with a Schneider lens, sheet film, extreme detail and smooth tonal gradation, camera movements',
      trait: '4×5 座机，可做移轴透视校正' },

    { id: 't2', name: 'Contax T2', cn: '康泰时 T2', grip: 'compact', format: 'ff',
      kind: 'film', gen: 'vintage', maxIso: 3200, baseIso: 100, minShutter: 1 / 500, maxShutter: 1,
      manual: false, advance: 'auto', flash: 'builtin',
      token: 'shot on a Contax T2 compact 35mm point-and-shoot, Zeiss Sonnar 38mm f/2.8, 1990s snapshot aesthetic',
      trait: '90 年代高级傻瓜机，快照感' },

    { id: 'sx70', name: 'Polaroid SX-70', cn: '宝丽来 SX-70', grip: 'instant', format: 'mf66',
      kind: 'instant', gen: 'vintage', maxIso: 160, baseIso: 160, minShutter: 1 / 200, maxShutter: 1 / 15,
      manual: false, advance: 'auto', flash: 'none', instant: true,
      token: 'shot on a Polaroid SX-70 instant camera, integral instant film print, soft low-contrast washed-out tones, slight colour shift toward green-magenta, visible white border',
      trait: '即时成像，低反差、褪色、白边' },

    { id: 'instax', name: 'Fujifilm Instax Mini', cn: '富士 Instax', grip: 'instant', format: 'mf66',
      kind: 'instant', gen: 'modern', maxIso: 800, baseIso: 800, minShutter: 1 / 400, maxShutter: 1 / 2,
      manual: false, advance: 'auto', flash: 'builtin', instant: true,
      token: 'shot on a Fujifilm Instax instant camera, small instant print, punchy contrast, cool slightly cyan cast, white plastic border',
      trait: '小尺寸拍立得，反差高、偏冷' },

    { id: 'iphone', name: 'iPhone 16 Pro', cn: 'iPhone 16 Pro', grip: 'phone', format: 'phone',
      kind: 'digital', gen: 'modern', maxIso: 12800, baseIso: 50, minShutter: 1 / 8000, maxShutter: 1,
      token: 'shot on a smartphone, computational photography, deep-fused HDR image, very deep depth of field, digitally smoothed textures, slight over-sharpening',
      trait: '计算摄影，全程深景深，算法锐化' },

    { id: 'pinhole', name: '针孔相机', cn: '自制针孔相机', grip: 'pinhole', format: 'lf45',
      kind: 'film', gen: 'vintage', maxIso: 400, baseIso: 100, minShutter: 1, maxShutter: 600,
      manual: true, advance: 'dark-slide', fixedAperture: 180, token: 'shot on a homemade pinhole camera, infinite depth of field, soft dreamy low-contrast rendering, heavy vignetting, extremely long exposure',
      trait: 'f/180 固定光圈，无限景深，朦胧' }
  ];

  /* ------------------------------------------------------------------ 镜头 */
  // dofK: 相对景深强度；distort: 畸变；render: 成像味道
  const LENSES = [
    { mm: 8,   cn: '8mm 鱼眼',        type: 'fisheye',   token: 'ultra-wide 8mm fisheye lens, severe barrel distortion, circular framing', trait: '鱼眼，画面被折叠成球' },
    { mm: 14,  cn: '14mm 超广角',      type: 'wide',      token: '14mm ultra-wide angle lens, dramatic perspective exaggeration, deep foreground-to-background depth', trait: '超广角，前景夸张、气势大' },
    { mm: 18,  cn: '18mm 广角',        type: 'wide',      token: '18mm wide angle lens, expansive spatial context', trait: '广角，交代环境' },
    { mm: 24,  cn: '24mm 广角',        type: 'wide',      token: '24mm wide angle lens, environmental context with mild edge stretching', trait: '新闻/风光常用广角' },
    { mm: 28,  cn: '28mm 小广角',      type: 'wide',      token: '28mm lens, natural reportage wide view', trait: '纪实经典广角' },
    { mm: 35,  cn: '35mm 人文',        type: 'standard',  token: '35mm lens, the classic documentary focal length, subject and environment in balance', trait: '人文视角，人与环境兼顾' },
    { mm: 50,  cn: '50mm 标准',        type: 'standard',  token: '50mm standard lens, perspective closest to human vision', trait: '标准镜头，接近人眼' },
    { mm: 58,  cn: '58mm 夜神',        type: 'standard',  token: '58mm lens with swirly vintage bokeh, dreamy central sharpness', trait: '老镜头的漩涡散景' },
    { mm: 85,  cn: '85mm 人像',        type: 'portrait',  token: '85mm portrait lens, flattering compression, subject isolated from background', trait: '人像黄金焦段' },
    { mm: 105, cn: '105mm 微距',       type: 'macro',     token: '105mm macro lens at 1:1 reproduction ratio, extreme close-up detail, paper-thin depth of field', trait: '微距，1:1 放大' },
    { mm: 135, cn: '135mm 中长焦',     type: 'tele',      token: '135mm telephoto lens, strong background compression, creamy separation', trait: '中长焦，压缩背景' },
    { mm: 200, cn: '200mm 长焦',       type: 'tele',      token: '200mm telephoto lens, tight framing, heavily compressed perspective', trait: '长焦，抓取远处' },
    { mm: 400, cn: '400mm 超长焦',     type: 'tele',      token: '400mm super telephoto lens, extreme compression, background reduced to a flat blur', trait: '超长焦，野生动物/体育' },
    { mm: 500, cn: '500mm 折返',       type: 'mirror',    token: '500mm catadioptric mirror lens, distinctive donut-shaped bokeh rings, low contrast', trait: '折返镜头，甜甜圈散景' }
  ];

  // 特殊镜头（覆盖型），单独作为一个开关
  const LENSMODS = [
    { id: 'none',    cn: '普通镜头',     token: '' },
    { id: 'tilt',    cn: '移轴 T/S',      token: 'tilt-shift lens, perspective corrected verticals, or a slice of selective focus across the frame', trait: '校正透视 / 制造移轴微缩感' },
    { id: 'anamorphic', cn: '变形宽银幕', token: 'anamorphic lens, 2.39:1 widescreen squeeze, horizontal blue lens flares, oval bokeh', trait: '电影宽银幕，蓝色拉丝眩光' },
    { id: 'soft',    cn: '柔焦镜头',      token: 'soft-focus lens, glowing halation around highlights, dreamy romantic diffusion', trait: '柔焦，高光泛光' },
    { id: 'probe',   cn: '微距探针',      token: 'macro probe lens, extreme wide close-up at ground level, surreal miniature perspective', trait: '探针镜头贴地广角' },
    { id: 'freelens',cn: '改装自由镜头',  token: 'freelensing, lens deliberately tilted off the mount, dramatic focus plane and light leaks', trait: '脱焦改装，光漏' }
  ];

  /* ------------------------------------------------------------------ 光圈 */
  // blades: 光圈叶片数，用于绘制与星芒计算
  const APERTURES = [
    { f: 1.0,  stop: 0,    token: 'aperture wide open at f/1.0, hair-thin depth of field, dreamy glow and softness wide open', blades: 9, dof: 'razor', trait: '夜神级，几乎只剩一条焦平面' },
    { f: 1.2,  stop: 0.5,  token: 'aperture wide open at f/1.2, paper-thin depth of field, luminous dreamy bokeh', blades: 9, dof: 'razor', trait: '极浅景深，通光量最大' },
    { f: 1.4,  stop: 1,    token: 'aperture wide open at f/1.4, extremely shallow depth of field, background melted into creamy bokeh', blades: 9, dof: 'very-shallow', trait: '人像常用的虚化极限' },
    { f: 1.8,  stop: 1.7,  token: 'aperture at f/1.8, very shallow depth of field, smooth out-of-focus background', blades: 7, dof: 'very-shallow', trait: '性价比虚化' },
    { f: 2.0,  stop: 2,    token: 'aperture at f/2, shallow depth of field with soft background separation', blades: 9, dof: 'shallow', trait: '' },
    { f: 2.8,  stop: 3,    token: 'aperture at f/2.8, moderate shallow depth of field, professional zoom wide open', blades: 9, dof: 'shallow', trait: '大三元全开可用' },
    { f: 4.0,  stop: 4,    token: 'aperture at f/4, balanced depth of field, subject clearly separated yet background readable', blades: 9, dof: 'moderate', trait: '人像与环境的平衡点' },
    { f: 5.6,  stop: 5,    token: 'aperture at f/5.6, moderate depth of field, lens at its optical sweet spot', blades: 9, dof: 'moderate', trait: '镜头最佳画质区间' },
    { f: 8.0,  stop: 6,    token: 'aperture at f/8, deep depth of field, front-to-back clarity, peak lens sharpness', blades: 9, dof: 'deep', trait: '风光经典光圈，最锐' },
    { f: 11,   stop: 7,    token: 'aperture at f/11, very deep depth of field, landscape-grade focus from foreground to horizon', blades: 9, dof: 'very-deep', trait: '' },
    { f: 16,   stop: 8,    token: 'aperture at f/16, extremely deep depth of field, sunstars radiating from bright highlights', blades: 9, dof: 'very-deep', trait: '深景深 + 星芒出现' },
    { f: 22,   stop: 9,    token: 'aperture at f/22, maximum depth of field, visible diffraction softening across the frame', blades: 7, dof: 'extreme', trait: '景深最大但衍射变软' },
    { f: 32,   stop: 10,   token: 'aperture at f/32, diffraction-limited image, overall softness from the tiny aperture', blades: 6, dof: 'extreme', trait: '衍射明显，整体变软' }
  ];

  /* ------------------------------------------------------------------ 快门 */
  // 数值秒。ev: 相对 1 秒的光圈级数（曝光值贡献）由 engine 计算
  const SHUTTERS = [
    { t: 1 / 8000, label: '1/8000', token: 'shutter speed 1/8000s, every trace of motion frozen dead still', motion: 'frozen' },
    { t: 1 / 4000, label: '1/4000', token: 'shutter speed 1/4000s, motion completely frozen', motion: 'frozen' },
    { t: 1 / 2000, label: '1/2000', token: 'shutter speed 1/2000s, crisp stopped-action', motion: 'frozen' },
    { t: 1 / 1000, label: '1/1000', token: 'shutter speed 1/1000s, action stopped sharply', motion: 'frozen' },
    { t: 1 / 500,  label: '1/500',  token: 'shutter speed 1/500s, fast action cleanly captured', motion: 'frozen' },
    { t: 1 / 250,  label: '1/250',  token: 'shutter speed 1/250s, typical flash sync, mild motion registration', motion: 'sharp' },
    { t: 1 / 125,  label: '1/125',  token: 'shutter speed 1/125s, safe handheld speed for careful technique', motion: 'sharp' },
    { t: 1 / 60,   label: '1/60',   token: 'shutter speed 1/60s, slight motion blur on fast subjects', motion: 'slight' },
    { t: 1 / 30,   label: '1/30',   token: 'shutter speed 1/30s, moving subjects show clear directional motion blur', motion: 'blur' },
    { t: 1 / 15,   label: '1/15',   token: 'shutter speed 1/15s, pronounced motion streaking', motion: 'blur' },
    { t: 1 / 8,    label: '1/8',    token: 'shutter speed 1/8s, strong motion trails from anything moving', motion: 'heavy' },
    { t: 1 / 4,    label: '1/4',    token: 'shutter speed 1/4s, heavy motion smear, ambient light dominates', motion: 'heavy' },
    { t: 1 / 2,    label: '1/2',    token: 'shutter speed 1/2s, long motion trails, camera shake visible', motion: 'heavy' },
    { t: 1,        label: '1s',     token: 'shutter speed 1 second, one-second exposure, moving elements streaked into ribbons', motion: 'long' },
    { t: 2,        label: '2s',     token: 'shutter speed 2 seconds, flowing motion rendered as smooth streaks', motion: 'long' },
    { t: 4,        label: '4s',     token: 'shutter speed 4 seconds, water and clouds beginning to smooth out', motion: 'long' },
    { t: 8,        label: '8s',     token: 'shutter speed 8 seconds, long exposure, moving water silked, people vanish into ghosts', motion: 'long' },
    { t: 15,       label: '15s',    token: 'shutter speed 15 seconds, long exposure, water turned to glass, traffic reduced to light trails', motion: 'very-long' },
    { t: 30,       label: '30s',    token: 'shutter speed 30 seconds, extreme long exposure, clouds smeared into streaks, water like mist', motion: 'very-long' },
    { t: 120,      label: '2min (B门)', token: 'bulb exposure of 2 minutes, star trails beginning to arc, deep-night accumulation', motion: 'bulb' },
    { t: 600,      label: '10min (B门)', token: 'bulb exposure of 10 minutes, continuous star trails circling the pole, long-exposure accumulation', motion: 'bulb' }
  ];

  /* ------------------------------------------------------------------ 胶片 */
  // tone: 调色关键词；grain: 颗粒强度 0-1；bw: 黑白
  const FILMS = [
    { id: 'digital', name: 'Digital RAW', cn: '数码原始文件', kind: 'digital', iso: 100, stock: false,
      token: 'digital RAW file, neutral colour, maximum detail', tone: '', grain: 0, swatch: ['#5d6b7a', '#c9d2da'] },

    /* ---- 柯达 彩色负片 ---- */
    { id: 'portra160', name: 'Kodak Portra 160', cn: '柯达 Portra 160', kind: 'color-neg', iso: 160, stock: true, brand: 'Kodak',
      token: 'Kodak Portra 160 colour negative film, exceptionally fine grain, delicate pastel palette, luminous soft skin tones',
      tone: 'soft pastel palette, gentle contrast, creamy warm highlights', grain: 0.12, swatch: ['#e8d5c0', '#c99a76'] },
    { id: 'portra400', name: 'Kodak Portra 400', cn: '柯达 Portra 400', kind: 'color-neg', iso: 400, stock: true, brand: 'Kodak',
      token: 'Kodak Portra 400 colour negative film, famous warm skin tones, fine natural grain, wide exposure latitude, low saturation elegance',
      tone: 'warm flattering skin tones, muted elegant saturation, fine grain', grain: 0.22, swatch: ['#f0d9be', '#c48b5e'] },
    { id: 'portra800', name: 'Kodak Portra 800', cn: '柯达 Portra 800', kind: 'color-neg', iso: 800, stock: true, brand: 'Kodak',
      token: 'Kodak Portra 800 colour negative film pushed in low light, visible but pleasing grain, warm available-light rendering',
      tone: 'warm low-light colour, pronounced grain structure', grain: 0.38, swatch: ['#e6c39c', '#a9713f'] },
    { id: 'ektar100', name: 'Kodak Ektar 100', cn: '柯达 Ektar 100', kind: 'color-neg', iso: 100, stock: true, brand: 'Kodak',
      token: 'Kodak Ektar 100 colour negative film, the world\'s finest grain colour negative, intensely saturated primary colours, vivid reds and blues',
      tone: 'hyper-saturated primaries, clean crisp colour, ultra fine grain', grain: 0.08, swatch: ['#e85a3a', '#2f6fb5'] },
    { id: 'gold200', name: 'Kodak Gold 200', cn: '柯达 金胶卷 200', kind: 'color-neg', iso: 200, stock: true, brand: 'Kodak',
      token: 'Kodak Gold 200 consumer colour negative film, nostalgic golden-yellow cast, sunny family-snapshot palette',
      tone: 'golden yellow nostalgic cast, warm sunny palette', grain: 0.28, swatch: ['#f2c04a', '#b8722a'] },
    { id: 'ultramax400', name: 'Kodak UltraMax 400', cn: '柯达 UltraMax 400', kind: 'color-neg', iso: 400, stock: true, brand: 'Kodak',
      token: 'Kodak UltraMax 400 colour negative film, punchy saturated consumer colour, unmistakable 1990s snapshot look',
      tone: 'punchy saturated colour, slight magenta bias', grain: 0.3, swatch: ['#e2503c', '#3d7fc1'] },

    /* ---- 柯达 反转片 ---- */
    { id: 'e100', name: 'Kodak Ektachrome E100', cn: '柯达 Ektachrome E100', kind: 'color-slide', iso: 100, stock: true, brand: 'Kodak',
      token: 'Kodak Ektachrome E100 slide film, clean neutral transparent colour, delicate highlight rolloff, projected-slide clarity',
      tone: 'clean neutral slide colour, luminous highlights, tight contrast', grain: 0.1, swatch: ['#dfe8ef', '#7fa8c6'] },

    /* ---- 富士 反转片 ---- */
    { id: 'velvia50', name: 'Fujifilm Velvia 50', cn: '富士 Velvia 50', kind: 'color-slide', iso: 50, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Velvia 50 slide film, legendary hyper-saturated landscape colour, deep ruby reds and emerald greens, high contrast, ultra fine grain',
      tone: 'hyper-saturated deep colour, high contrast, velvet blacks', grain: 0.06, swatch: ['#c8153a', '#0f7a4a'] },
    { id: 'provia100f', name: 'Fujifilm Provia 100F', cn: '富士 Provia 100F', kind: 'color-slide', iso: 100, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Provia 100F slide film, neutral accurate colour reproduction, professional transparency film',
      tone: 'neutral accurate professional slide colour', grain: 0.1, swatch: ['#d8e2e8', '#6f8fa8'] },
    { id: 'astia', name: 'Fujifilm Astia 100F', cn: '富士 Astia 100F', kind: 'color-slide', iso: 100, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Astia 100F slide film, soft muted skin tones, gentle low-contrast rendering favoured for portraiture',
      tone: 'soft muted gentle colour, low contrast skin', grain: 0.1, swatch: ['#e8dcd2', '#b39585'] },

    /* ---- 富士 彩色负片 ---- */
    { id: 'pro400h', name: 'Fujifilm Pro 400H', cn: '富士 Pro 400H', kind: 'color-neg', iso: 400, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Pro 400H colour negative film, pastel airy palette, delicate cyan-green shadows, dreamy light wedding look',
      tone: 'airy pastel palette, cyan-green shadows, delicate highlights', grain: 0.2, swatch: ['#d7e6e4', '#8fb3b8'] },
    { id: 'superia400', name: 'Fujifilm Superia X-TRA 400', cn: '富士 Superia 400', kind: 'color-neg', iso: 400, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Superia X-TRA 400 consumer film, cool blue-green cast, vivid punchy colour with strong contrast',
      tone: 'cool blue-green cast, punchy vivid contrast', grain: 0.32, swatch: ['#3f8fa8', '#c5de44'] },

    /* ---- 黑白 ---- */
    { id: 'tri-x400', name: 'Kodak Tri-X 400', cn: '柯达 Tri-X 400（黑白）', kind: 'bw-neg', iso: 400, stock: true, brand: 'Kodak',
      token: 'Kodak Tri-X 400 black and white negative film, gritty documentary grain, rich silver blacks, legendary photojournalism look',
      tone: 'rich silver gelatin blacks, gritty grain, classic reportage tonality', grain: 0.45, swatch: ['#1a1a1a', '#b8b8b8'], bw: true },
    { id: 'tmax100', name: 'Kodak T-Max 100', cn: '柯达 T-Max 100（黑白）', kind: 'bw-neg', iso: 100, stock: true, brand: 'Kodak',
      token: 'Kodak T-Max 100 black and white film, extremely fine grain, extended tonal range from deep black to brilliant white',
      tone: 'very fine grain, long smooth tonal scale, clinical sharpness', grain: 0.1, swatch: ['#0f0f0f', '#d4d4d4'], bw: true },
    { id: 'tmax400', name: 'Kodak T-Max 400', cn: '柯达 T-Max 400（黑白）', kind: 'bw-neg', iso: 400, stock: true, brand: 'Kodak',
      token: 'Kodak T-Max 400 black and white film, modern tabular grain, fine sharp grain and clean tonality',
      tone: 'clean modern black and white, sharp fine grain', grain: 0.25, swatch: ['#141414', '#c8c8c8'], bw: true },
    { id: 'hp5', name: 'Ilford HP5 Plus 400', cn: '依尔福 HP5 Plus 400（黑白）', kind: 'bw-neg', iso: 400, stock: true, brand: 'Ilford',
      token: 'Ilford HP5 Plus 400 black and white film, classic British monochrome, gentle contrast, wonderfully pushable and grainy',
      tone: 'classic gentle monochrome contrast, honest mid-tones', grain: 0.42, swatch: ['#1c1c1c', '#b0b0b0'], bw: true },
    { id: 'delta100', name: 'Ilford Delta 100', cn: '依尔福 Delta 100（黑白）', kind: 'bw-neg', iso: 100, stock: true, brand: 'Ilford',
      token: 'Ilford Delta 100 black and white film, fine grained modern emulsion, crisp detailed monochrome with beautiful tonality',
      tone: 'crisp fine-grain monochrome, wide clean tonal range', grain: 0.12, swatch: ['#101010', '#d0d0d0'], bw: true },
    { id: 'delta3200', name: 'Ilford Delta 3200', cn: '依尔福 Delta 3200（黑白）', kind: 'bw-neg', iso: 3200, stock: true, brand: 'Ilford',
      token: 'Ilford Delta 3200 black and white film shot in near darkness, heavy expressive grain, moody nocturnal monochrome',
      tone: 'heavy expressive grain, moody dark-toned monochrome', grain: 0.72, swatch: ['#1a1a1a', '#9a9a9a'], bw: true },
    { id: 'panf50', name: 'Ilford Pan F Plus 50', cn: '依尔福 Pan F 50（黑白）', kind: 'bw-neg', iso: 50, stock: true, brand: 'Ilford',
      token: 'Ilford Pan F Plus 50 black and white film, the finest grain available, silky smooth mid-tones, contrast that sings',
      tone: 'finest grain, silky mid-tones, luminous highlights', grain: 0.06, swatch: ['#0c0c0c', '#dadada'], bw: true },
    { id: 'acros100', name: 'Fujifilm Acros 100 II', cn: '富士 Acros 100（黑白）', kind: 'bw-neg', iso: 100, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Acros 100 II black and white film, superb shadow detail, smooth gradation, deep rich blacks without blocking up',
      tone: 'detailed shadows, smooth gradation, deep clean blacks', grain: 0.14, swatch: ['#131313', '#cccccc'], bw: true },
    { id: 'ferrania', name: 'Ferrania P30', cn: 'Ferrania P30（黑白）', kind: 'bw-neg', iso: 80, stock: true, brand: 'Ferrania',
      token: 'Ferrania P30 black and white film, cinematic high-contrast monochrome, deep crushed blacks, Italian neorealist mood',
      tone: 'high contrast cinematic monochrome, crushed blacks', grain: 0.2, swatch: ['#080808', '#c0c0c0'], bw: true },
    { id: 'shanghai', name: '上海 GP3 100', cn: '上海 GP3 100（黑白）', kind: 'bw-neg', iso: 100, stock: true, brand: '上海',
      token: 'Shanghai GP3 100 black and white film, Chinese-made classic emulsion, slightly soft tonality, nostalgic grainy texture',
      tone: 'soft nostalgic tonality, vintage grain texture', grain: 0.3, swatch: ['#181818', '#bcbcbc'], bw: true },

    /* ---- 电影卷 ---- */
    { id: 'cinestill800t', name: 'CineStill 800T', cn: 'CineStill 800T（电影卷）', kind: 'cine', iso: 800, stock: true, brand: 'CineStill',
      token: 'CineStill 800T tungsten-balanced motion picture film, glowing red halation blooming around highlights, cyan teal shadows, neon night cinematic look',
      tone: 'teal shadows, glowing red halation around lights, cinematic neon', grain: 0.4, swatch: ['#0f3b45', '#e8402c'] },
    { id: 'vision3', name: 'Kodak Vision3 250D', cn: '柯达 Vision3 250D（电影卷）', kind: 'cine', iso: 250, stock: true, brand: 'Kodak',
      token: 'Kodak Vision3 250D motion picture film stock, Hollywood cinematography colour, wide latitude and smooth highlight rolloff',
      tone: 'cinematic neutral-rich colour, filmic highlight rolloff', grain: 0.18, swatch: ['#c9b48a', '#4d6b78'] },

    /* ---- 即时 ---- */
    { id: 'sx70film', name: 'Polaroid SX-70 Film', cn: '宝丽来 SX-70 胶片', kind: 'instant', iso: 160, stock: true, brand: 'Polaroid',
      token: 'Polaroid SX-70 integral instant film, low contrast faded pastel tones, warm magenta-green colour shift, soft hazy rendering, thick white frame',
      tone: 'faded low-contrast pastels, warm colour drift, hazy soft', grain: 0.35, swatch: ['#d9c9bd', '#8a9e8f'] },
    { id: 'polaroid600', name: 'Polaroid 600', cn: '宝丽来 600', kind: 'instant', iso: 640, stock: true, brand: 'Polaroid',
      token: 'Polaroid 600 instant film, punchy retro contrast, cyan-blue cast in shadows, glossy instant print',
      tone: 'retro punchy contrast, cool cyan shadows', grain: 0.4, swatch: ['#7fa8c4', '#e0d3b8'] },
    { id: 'instaxfilm', name: 'Fujifilm Instax', cn: '富士 Instax 相纸', kind: 'instant', iso: 800, stock: true, brand: 'Fujifilm',
      token: 'Fujifilm Instax instant print, bright saturated punchy colour, slightly cool cast, high contrast',
      tone: 'bright punchy saturated colour, cool cast', grain: 0.25, swatch: ['#66c0d8', '#f0a8b8'] },

    /* ---- 黑白转制 ---- */
    { id: 'bw-conv', name: 'Digital B&W', cn: '数码转黑白', kind: 'bw-conv', iso: 100, stock: false,
      token: 'converted to luminous black and white, deep contrast, monochrome fine art',
      tone: 'clean digital monochrome, controlled contrast', grain: 0.05, swatch: ['#111111', '#dddddd'], bw: true }
  ];

  /* ------------------------------------------------------------------ 滤镜 */
  const FILTERS = [
    { id: 'none',  cn: '不加滤镜', token: '' },
    { id: 'cpl',   cn: '偏振镜 CPL', token: 'circular polarising filter, deepened blue sky, glare and reflections removed from water and glass, richer saturated colour' },
    { id: 'nd6',   cn: 'ND8 减光镜', token: '3-stop neutral density filter, allowing a slower shutter in daylight' },
    { id: 'nd10',  cn: 'ND1000 减光镜', token: '10-stop neutral density filter, enabling multi-second exposures in bright daylight' },
    { id: 'gnd',   cn: '渐变灰 GND', token: 'graduated neutral density filter, sky held back while the foreground stays correctly exposed' },
    { id: 'soft',  cn: '黑柔 Black Mist', token: 'black mist diffusion filter, highlights blooming into a soft halation glow, gentle low contrast' },
    { id: 'star',  cn: '星芒镜 4x', token: 'cross screen star filter, every point of light bursting into a four-point star' },
    { id: 'blue',  cn: '蓝调滤镜', token: 'cool blue colour correction filter, cooling the overall palette' },
    { id: 'warm',  cn: '暖调 81B', token: 'warming 81B filter, adding golden warmth to the scene' },
    { id: 'y2',    cn: '黄镜（黑白）', token: 'yellow filter on black and white film, darkening the blue sky and rendering clouds dramatically' },
    { id: 'o56',   cn: '橙镜（黑白）', token: 'orange filter on black and white film, deepening skin freckles and darkening sky for dramatic contrast' },
    { id: 'r25',   cn: '红镜（黑白）', token: 'deep red filter on black and white film, nearly black sky and dramatic pale skin' },
    { id: 'ir',    cn: '红外 IR', token: 'infrared photography, foliage glowing white, black sky, surreal dreamlike tonal inversion' }
  ];

  /* ------------------------------------------------------------------ 闪光 */
  const FLASHES = [
    { id: 'none',     cn: '自然光',     token: '' },
    { id: 'builtin',  cn: '机顶直闪',   token: 'direct on-camera flash, hard frontal light, sharp shadow edge behind the subject, bright specular highlights on skin' },
    { id: 'bounce',   cn: '跳闪',       token: 'flash bounced off the ceiling, soft even fill light, gentle shadow beneath the chin' },
    { id: 'off',      cn: '离机闪光',   token: 'off-camera strobe at 45 degrees, sculpted directional light, defined shadow falling across the background' },
    { id: 'ring',     cn: '环形闪光灯', token: 'ring flash, shadowless even frontal light, distinctive circular catchlight in the eyes' },
    { id: 'slow-sync',cn: '慢速同步',   token: 'rear-curtain slow sync flash, a frozen flash-lit subject with ambient motion trails ghosting behind it' },
    { id: 'multi',    cn: '频闪多重',   token: 'stroboscopic multi-pop flash, a moving subject repeated several times across a single frame' },
    { id: 'gel',      cn: '色片闪光',   token: 'flash gelled with coloured gel, a saturated colour wash separating the subject from a cool background' }
  ];

  return { FORMATS, BODIES, LENSES, LENSMODS, APERTURES, SHUTTERS, FILMS, FILTERS, FLASHES };
})();
