/* ==========================================================================
   lessons.js —— 教材课程 + 快速配方
   课程结构对齐《美国纽约摄影学院摄影教材》的单元脉络：
   眼力 → 相机 → 镜头 → 曝光 → 景深 → 运动 → 光线 → 构图 → 滤镜 → 胶片 → 专题
   每节课都能"一键装载"到模拟器，并给出建议的对比试拍维度。
   ========================================================================== */
window.LESSONS = [

  { no: '01', title: '好照片的三条基本原则',
    body: '纽约摄影学院开篇就给出了一把尺子：一张好照片，①要有鲜明的主题；②要把观众的注意力引向被摄主体；③画面要简洁，把分散注意力的东西统统去掉。技术只是手段，这三条才是目的。',
    points: ['先想清楚"我要说什么"，再决定按不按快门', '主体必须明确——一眼看过去，观众知道该看哪里', '简洁是最难的一课：凡是与主题无关的元素，都是敌人'],
    preset: { scene: 'street-portrait', body: 'm6', lens: 35, aperture: 2.8, film: 'tri-x400', composition: 'thirds', technique: 'none' },
    compare: { dim: 'lens', a: 35, b: 135, tip: '同一主体，35mm 交代环境、135mm 切掉干扰——这就是"简洁"的操作方式。' } },

  { no: '02', title: '相机：从大画幅到手机',
    body: '画幅决定了一切的下限：底片越大，能记录的层次越多、景深越浅、可放大的倍率越高。4×5 座机至今仍是建筑与静物的王者，因为它的前后组可以各自平移、俯仰，把透视和焦平面从光学里"掰"回来。',
    points: ['弥散圈随画幅增大而增大 → 同样视角下景深更浅', '座机的移轴能校正垂直线汇聚，也能反向制造微缩感', '小画幅的代价是宽容度与信噪比，不是"拍不出好照片"'],
    preset: { scene: 'architecture', body: 'sinar', lens: 150, aperture: 22, shutter: 1 / 8, film: 'provia100f', lensMod: 'tilt', composition: 'centre' },
    compare: { dim: 'lens', a: 24, b: 150, tip: '广角会把楼"推倒"（垂直线汇聚），长焦会把前后压扁——移轴就是在两者之间找答案。' } },

  { no: '03', title: '标准镜头：最像人眼的那支',
    body: '全画幅 50mm 的水平视角约 40°，与人眼的"注意力视场"相近，所以它拍出来的东西最"不奇怪"。初学者的第一支定焦应当是它——因为它逼你用脚去构图。',
    points: ['50mm 的透视最中性，不夸张也不压缩', '定焦逼你移动，移动产生思考', 'f/1.8 的 50mm 是性价比最高的虚化工具'],
    preset: { scene: 'street-doc', body: 'fm2', lens: 50, aperture: 2.8, shutter: 1 / 250, film: 'tri-x400', composition: 'thirds', technique: 'none' },
    compare: { dim: 'lens', a: 50, b: 24, tip: '走近一点用 24mm，退远一点用 50mm——拍到的"内容"完全不同。' } },

  { no: '04', title: '曝光三要素与测光表',
    body: '光圈、快门、ISO 构成一个"曝光三角形"。改变任意一边，都要用另一边补回来。模拟器右侧的 EV 测光尺就是相机的测光表：指针偏右是过曝，偏左是欠曝。',
    points: ['EV = log₂(N²/t)，N 是光圈值、t 是快门秒数', 'ISO 每翻一倍，相当于多给一级曝光（或把快门减半）', '阳光十六法则：f/16 + 1/125 + ISO100 拍正午阳光'],
    preset: { scene: 'snowfield', body: 'd850', lens: 35, aperture: 16, shutter: 1 / 250, film: 'digital', iso: 100, composition: 'leading' },
    compare: { dim: 'shutter', a: 1 / 125, b: 1 / 1000, tip: '雪地会让测光表"变傻"：它想把白雪拍成中灰。看两张的亮度差。' } },

  { no: '05', title: '景深：控制清晰范围',
    body: '景深由三件事决定：光圈、焦距、拍摄距离。光圈越小、焦距越短、距离越远，清晰范围越大。模拟器右下角的景深标尺会实时告诉你"从 x 米到 y 米是清晰的"。',
    points: ['光圈每缩小一级（f 值×1.4），景深约增加一档', '焦距的影响是平方级的：焦距翻倍，景深掉到约 1/4', '超焦距：对焦在 H 上，从 H/2 到无穷远全部清晰'],
    preset: { scene: 'mountain-sunrise', body: 'a7rv', lens: 24, aperture: 11, shutter: 1 / 60, film: 'digital', dist: 100, composition: 'layered' },
    compare: { dim: 'aperture', a: 1.4, b: 16, tip: '同一机位同一焦距，只改光圈。背景从"奶油"变成"清晰"——这就是景深。' } },

  { no: '06', title: '景深实战：人像与风光',
    body: '人像要"把背景化掉"，风光要"全都清楚"，这是景深的两极。人像用长焦 + 大光圈 + 靠近；风光用广角 + 小光圈 + 超焦距对焦。',
    points: ['人像：85mm f/1.8 在 3 米处，景深常常只有十几厘米', '风光：24mm f/11 对焦在超焦距，前后全实', '微距是极端情况：1:1 时景深可能只有 2 毫米'],
    preset: { scene: 'elder', body: 'r5', lens: 85, aperture: 1.4, shutter: 1 / 250, film: 'portra400', dist: 1.8, composition: 'frame' },
    compare: { dim: 'aperture', a: 2.8, b: 11, tip: '同一位老人，f/2.8 只有眼睛清楚，f/11 连身后的木屑都清楚——讲故事的方式变了。' } },

  { no: '07', title: '快门：凝固与流动',
    body: '快门速度是"时间的宽度"。1/1000 把水滴冻在半空，1 秒把瀑布拉成丝绸。判断标准只有一个：主体在曝光期间移动了多少个像素。',
    points: ['像素位移 = 速度 × 快门 × 焦距 ÷ 距离 ÷ 像元尺寸', '手持安全快门 ≈ 1/焦距（全画幅）', '拍流水：1/1000 是冰凌，1/15 是拉丝，1 秒以上是绸缎'],
    preset: { scene: 'waterfall', body: 'a7rv', lens: 35, aperture: 11, shutter: 1, film: 'digital', iso: 100, technique: 'longexp', filter: 'nd10', composition: 'layered' },
    compare: { dim: 'shutter', a: 1 / 500, b: 1, tip: '同一道瀑布，1/500 溅起的水花粒粒分明，1 秒则整面化成丝绸。' } },

  { no: '08', title: '追随拍摄：用模糊表达速度',
    body: '把相机对准主体、跟着它一起转，主体就被"追住"了——它相对静止，而背景相对高速掠过。于是背景被拉成水平线条，速度感反而被拍了出来。',
    points: ['机身必须与主体角速度同步，腰要转不要抖', '快门 1/30 左右是常见甜点区', '失败也好看：主体轻微拖影反而更"快"'],
    preset: { scene: 'sport-cycle', body: 'z9', lens: 200, aperture: 5.6, shutter: 1 / 30, film: 'digital', iso: 100, technique: 'panning', composition: 'thirds' },
    compare: { dim: 'technique', a: 'freeze', b: 'panning', tip: '同一台自行车：凝固是"运动被暂停"，追随是"运动被看见"。' } },

  { no: '09', title: '光线：摄影唯一真正的原材料',
    body: '摄影师是用光画画的人。光的方向决定立体感，光的软硬决定质感，光的色温决定情绪。伦勃朗用 45° 主光在脸颊上留下一个倒三角，那是四百年前就定下的配方。',
    points: ['正面光平、侧面光立体、逆光梦幻但也最容易曝错', '大光源=柔光，小光源=硬光（柔光箱不是"柔"的，是"大"的）', '阴天是天然的巨大柔光箱，人像肤色最好看'],
    preset: { scene: 'studio-portrait', body: 'r5', lens: 85, aperture: 4, shutter: 1 / 160, film: 'digital', iso: 100, technique: 'rembrandt', composition: 'centre' },
    compare: { dim: 'technique', a: 'rembrandt', b: 'butterfly', tip: '同为单灯，光的角度差 45°，脸的骨架感完全不同。' } },

  { no: '10', title: '高调与低调',
    body: '一张照片的"调子"由明暗分布决定。高调是白上加白，轻盈透亮；低调是暗里取光，戏剧而克制。两者都不是"亮度设置"，而是审美选择。',
    points: ['高调需要大量浅色元素 + 轻微过曝 1/3 到 1 级', '低调需要深色背景 + 单只光精准打亮主体', '低调照片的黑要"黑得下去"，不能是灰的'],
    preset: { scene: 'still-life', body: 'x2d', lens: 105, aperture: 5.6, shutter: 1 / 60, film: 'digital', iso: 64, technique: 'low-key', composition: 'negative' },
    compare: { dim: 'technique', a: 'high-key', b: 'low-key', tip: '同样一只橙子，白上白是清新，黑里透光是丰饶。' } },

  { no: '11', title: '构图：把注意力收拢',
    body: '构图不是"怎么摆"，而是"让眼睛走哪条路"。三分法是最省力的起点，引导线把视线送进画面深处，框架构图给主体一个门，留白则让呼吸变得可能。',
    points: ['先把主体放在三分点上，再考虑是否要打破它', '引导线必须有终点——终点就是你的主体', '凑近、再凑近：多数照片的问题是主体不够大'],
    preset: { scene: 'old-town', body: 'm6', lens: 35, aperture: 5.6, shutter: 1 / 60, film: 'portra400', composition: 'frame' },
    compare: { dim: 'lens', a: 14, b: 85, tip: '广角把观众"吸进"巷子，长焦把巷子"压平"成图案。' } },

  { no: '12', title: '逆光与剪影',
    body: '逆光是最难也最出效果的光。你要么放弃主体的细节，把它变成干净的黑色形状（剪影）；要么保住主体，用补光或曝光补偿把阴影提起来。中间状态最难受。',
    points: ['剪影的关键是"轮廓可读"——形状必须一眼认得出', '要剪影就减曝光，让背景的高光占满直方图右侧', '要细节就用反光板或闪光灯，别指望后期硬提'],
    preset: { scene: 'wedding', body: 'a7rv', lens: 135, aperture: 2.8, shutter: 1 / 1000, film: 'digital', iso: 100, technique: 'silhouette', composition: 'negative' },
    compare: { dim: 'aperture', a: 2.8, b: 8, tip: '同一次逆光，曝光与景深的取舍会决定"人"还是"光"当主角。' } },

  { no: '13', title: '滤镜：镜头前的另一支笔',
    body: '偏振镜让你"擦掉"水面和玻璃的反光，加深天空；减光镜让你在正午也能用 1 秒的快门；渐变灰让天空和地面同时有细节。滤镜不是后期，它改变的是入射光本身。',
    points: ['CPL 最强效果在太阳侧方 90°，顺光基本无效', 'ND1000 能让白天 1/125 变成 8 秒', '黑白摄影用黄/橙/红滤镜压暗天空，这是数字时代也值得体验的技法'],
    preset: { scene: 'seaside', body: 'd850', lens: 24, aperture: 11, shutter: 8, film: 'digital', iso: 64, filter: 'nd10', technique: 'longexp', composition: 'layered' },
    compare: { dim: 'shutter', a: 1 / 125, b: 8, tip: '同一个海岸，1/125 是浪的瞬间，8 秒是礁石的永恒。' } },

  { no: '14', title: '胶片：不同的眼睛',
    body: '每种胶片都是一套被固化的审美。Velvia 50 把绿色和红色推到极致，是风光的暴烈；Portra 400 把肤色拉向温暖，是人像的温柔；Tri-X 400 的粗颗粒就是新闻摄影的体温。',
    points: ['反转片（如 Velvia）宽容度极窄，曝光必须准', '负片（如 Portra）宽容度大，过曝 1–2 级仍可救', '黑白不是"没有颜色"，而是把世界翻译成明暗关系'],
    preset: { scene: 'street-portrait', body: 'm6', lens: 50, aperture: 2, shutter: 1 / 250, film: 'portra400', composition: 'thirds' },
    compare: { dim: 'film', a: 'velvia50', b: 'portra400', tip: '同一场日落：Velvia 是刀，Portra 是毛毯。' } },

  { no: '15', title: '高感光与颗粒',
    body: '感光度越高，颗粒越粗、层次越少、色调越"脏"——但在黑暗里，它是唯一的出路。ISO 3200 的 Delta 3200 不是缺陷，那是夜的味道。',
    points: ['数字相机 ISO 越高，动态范围越窄，高光越容易死', '噪点和颗粒不同：颗粒有形状，噪点没有', '演唱会、夜景纪实，别怕上 3200'],
    preset: { scene: 'concert', body: '5d4', lens: 85, aperture: 1.4, shutter: 1 / 125, film: 'digital', iso: 3200, composition: 'thirds' },
    compare: { dim: 'film', a: 'delta3200', b: 'acros100', tip: '同一处弱光：3200 的颗粒是情绪，100 的干净是奢侈。' } },

  { no: '16', title: '专题：把一种题材拍透',
    body: '最后一课回到起点。教材里的每一位大师，都是把一个题材拍到别人无法再拍。选一个你走得到、又愿意反复去的地方或人，用同一种器材、同一种胶片，拍上一年。',
    points: ['限制器材就是训练眼力，换镜头太快反而学不到东西', '为你的主题建立"参数直觉"，再打破它', '好照片是被等出来的，不是被拍出来的'],
    preset: { scene: 'market', body: 'm6', lens: 35, aperture: 2.8, shutter: 1 / 125, film: 'tri-x400', composition: 'thirds' },
    compare: { dim: 'shutter', a: 1 / 250, b: 1 / 15, tip: '同一处集市，快门的选择决定你"记录"还是"感受"。' } }
];

/* ------------------------------------------------------------------ 快速配方 */
window.QUICK_PRESETS = [
  { cn: '雨夜霓虹',     state: { scene: 'neon-night', body: 'fm2', lens: 50, aperture: 1.4, shutter: 1 / 60, film: 'cinestill800t', technique: 'none', composition: 'thirds' } },
  { cn: '风光超焦距',   state: { scene: 'mountain-sunrise', body: 'a7rv', lens: 24, aperture: 11, shutter: 1 / 60, film: 'digital', dist: 1000, composition: 'layered' } },
  { cn: '丝绸海浪',     state: { scene: 'seaside', body: 'd850', lens: 24, aperture: 11, shutter: 30, film: 'digital', iso: 64, filter: 'nd10', technique: 'longexp' } },
  { cn: '摇拍自行车',   state: { scene: 'sport-cycle', body: 'z9', lens: 200, aperture: 5.6, shutter: 1 / 30, film: 'digital', technique: 'panning' } },
  { cn: '影棚伦勃朗',   state: { scene: 'studio-portrait', body: 'r5', lens: 85, aperture: 4, shutter: 1 / 160, film: 'digital', technique: 'rembrandt' } },
  { cn: 'Velvia 风光',  state: { scene: 'desert', body: 'fm2', lens: 28, aperture: 11, shutter: 1 / 125, film: 'velvia50', composition: 'leading' } },
  { cn: 'Tri-X 纪实',   state: { scene: 'street-doc', body: 'm6', lens: 35, aperture: 5.6, shutter: 1 / 250, film: 'tri-x400', composition: 'thirds' } },
  { cn: '微距露珠',     state: { scene: 'flower-macro', body: 'a7rv', lens: 105, aperture: 16, shutter: 1 / 60, film: 'digital', dist: 0.3, composition: 'fill-frame' } },
  { cn: '银河星野',     state: { scene: 'starscape', body: 'z9', lens: 14, aperture: 1.8, shutter: 15, film: 'digital', iso: 3200, technique: 'none' } },
  { cn: '宝丽来午后',   state: { scene: 'cafe-window', body: 'sx70', lens: 50, aperture: 4, shutter: 1 / 60, film: 'sx70film', composition: 'negative' } },
  { cn: '低调静物',     state: { scene: 'still-life', body: 'x2d', lens: 105, aperture: 5.6, shutter: 1 / 60, film: 'digital', technique: 'low-key' } },
  { cn: '黑白雪原',     state: { scene: 'snowfield', body: 'rb67', lens: 80, aperture: 16, shutter: 1 / 125, film: 'acros100', composition: 'negative' } }
];
