// Fictional opinion corpus, generated from hand-authored clause banks.
//
// The corpus is a controlled design, not a random sample:
//
//   5 time windows x 5 documents. Every window contains all three document types
//   (投诉 T, 建议 S, 咨询 C) so that composition adjustment has common support.
//   The type mix still shifts over time, which is what drives the composition
//   artefact below.
//
//   w1  T T T T C
//   w2  T T T S C
//   w3  T T S S C
//   w4  T S S S C
//   w5  T S S C C
//
// Clause labels by document type (5 clauses each):
//
//   T  noise · parking · safety · green · service
//   S  parking · fee · green · safety · service
//   C  fee · fee+green · fee · green · service
//
// Two designed effects, both asserted in tests/drift.test.js:
//
//   1. COMPOSITION ARTEFACT. Coder A codes `fee` in every C clause 0–2, in S
//      clause 1, and never in T. A's within-type behaviour is constant in time.
//      Because the mix shifts toward S and C, A's raw fee share climbs. After
//      re-weighting to the whole-period mix, A's fee series is flat.
//
//   2. PERSONAL DRIFT. Coder B additionally codes borderline clauses as
//      `service`: clause 2 from w3 onward, clause 3 from w5 onward. This happens
//      inside every document type, so it survives composition adjustment.
//
// Segmentation differences are systematic:
//   A merges some adjacent clauses into one span (and unions their topics);
//   B emits one span per clause, splitting multi-topic clauses into overlapping
//   spans. Topics per character are the same on those runs, so they register as
//   boundary disagreement, not topic disagreement.
//
// D07 is the revision demo: it contains an exactly repeated sentence, and its v2
// inserts, deletes, duplicates and rewrites text.

export const TOPICS = [
  { id: 'noise', label: '噪音', color: 0, note: '早市喇叭、卸货、夜间施工等声响干扰' },
  { id: 'parking', label: '停车', color: 1, note: '机动车与非机动车停放、车位分配' },
  { id: 'green', label: '绿化', color: 2, note: '绿地、草皮、灌木、围栏与养护' },
  { id: 'fee', label: '收费', color: 3, note: '物业费、停车费、摊位费、押金及公示' },
  { id: 'safety', label: '安全', color: 4, note: '消防通道、门禁、照明、充电、儿童活动区' },
  { id: 'service', label: '服务', color: 5, note: '物业服务响应、清运、管理方处置与流程' },
];

export const CODERS = [
  { id: 'A', name: '编码者甲', note: '按段落切分，跨句合并，允许一段多主题' },
  { id: 'B', name: '编码者乙', note: '按单句切分，一句多主题时用重叠区间' },
];

export const WINDOWS = ['w1', 'w2', 'w3', 'w4', 'w5'];

const TYPE_ORDER = { T: 0, S: 1, C: 2 };
const TYPE_LABEL = { T: '投诉', S: '建议', C: '咨询' };

// Clause banks. Each entry is the text for that type at that clause slot.
const BANK = {
  T: [
    ['东门早市的摊位摆到九点，喇叭声从五点就没停过。',
      '西门外的小吃摊每天清晨用扩音器招揽客人。',
      '楼下的夜宵摊营业到凌晨，划拳声传得很远。',
      '早市卸货的三轮车在楼下按喇叭催人让路。'],
    ['摊主的三轮车占了两个机动车位，告示被撕掉了。',
      '单元门口经常被临时停放的货车堵住，婴儿车推不过去。',
      '地下车库的入口被两辆车并排停着，只剩一条窄缝。',
      '非机动车棚里堆满杂物，电动车只能停在楼道口。'],
    ['消防通道长期堆着纸箱，物业清理过一次又恢复了。',
      '楼道里的电动车充电一直没解决，上周还跳过一次闸。',
      '地下车库的照明坏了三个月，转弯处的反光镜也碎了。',
      '消防栓前面被当成了停车位，我看着很担心。'],
    ['绿化带靠近车道的一侧没有护栏，晚上只能贴着墙走。',
      '有人从六楼拉线充电，线就挂在绿化带的树枝上。',
      '绿化带里被倒了泔水，夏天味道很大，蚊虫也多。',
      '绿化带的围栏倒了一段，一直没有人修。'],
    ['我们的诉求很简单，先把消防通道和照明修好。',
      '希望市场管理方给出明确的收摊时间和进场时间。',
      '保安说他们只能劝，没有执法权，问题一直拖着。',
      '希望街道办牵头，把早市的范围和时间定下来。'],
  ],
  S: [
    ['建议在东门内侧划出固定的非机动车位。',
      '建议晚高峰开放地下车库的临时车位。',
      '建议把楼前的空地改成非机动车停放区。',
      '建议给每个单元划出两米宽的临时卸货位。'],
    ['摊位费可以按天收取，并公示收费标准。',
      '电梯广告的收入去向不明，建议单独列一项。',
      '临时停车的收费标准应该和月租分开公示。',
      '建议把物业费的明细每季度公开一次。'],
    ['绿化带被踩出了一条土路，建议补种草皮。',
      '绿化带的自动喷灌经常在中午开启，水都蒸发了。',
      '建议在绿化带边缘加一排矮栏杆。',
      '建议把枯死的灌木换掉，补种耐阴的品种。'],
    ['如果能加装两个监控，快递丢失的情况会少一些。',
      '建议在儿童活动区加装遮阳棚。',
      '活动区的照明可以在傍晚延长半小时。',
      '建议在消防通道口加装一处反光标识。'],
    ['这些改动不需要大工程，先在一个门试运行。',
      '这些调整成本不高，物业可以先试一个月。',
      '如果预算不够，先修最危险的两处也行。',
      '建议公示整改进度，每月更新一次。'],
  ],
  C: [
    ['想咨询小区停车费的收费标准是怎么定的。',
      '想了解早市摊位费的收取方式。',
      '请问小区门禁卡押金的收费依据是什么。',
      '咨询物业费的调价流程需要多少业主同意。'],
    ['物业费里绿化养护占多少比例，今年预算在哪里查。',
      '摊位费的收入是否用于绿化带的日常维护。',
      '听说明年绿化养护的预算要减少，减少多少。',
      '绿化养护外包公司的收费标准能否公开。'],
    ['如果摊主中途退出，已经交的摊位费能不能退。',
      '停车费的调价方案在哪里公示。',
      '押金退还是否需要收据，收据丢了还能退吗。',
      '这部分收入的明细会不会在公告栏公示。'],
    ['如果绿化养护没有完成，这部分费用会退还吗。',
      '绿化带围栏的维修是否也在这次的维修计划里。',
      '如果预算减少，公共绿地的维护由谁负责。',
      '补种草皮的养护周期一般是多久。'],
    ['希望回复时能附上收费依据的文件编号。',
      '请告知负责收费的具体部门和联系电话。',
      '希望物业公布维修进度和收费依据。',
      '请把调价的听证记录一并公示。'],
  ],
};

const BASE_TOPICS = {
  T: [['noise'], ['parking'], ['safety'], ['green'], ['service']],
  S: [['parking'], ['fee'], ['green'], ['safety'], ['service']],
  C: [['fee'], ['fee', 'green'], ['fee'], ['green'], ['service']],
};

// Type mix per window. Every window contains T, S and C (common support).
export const WINDOW_MIX = {
  w1: ['T', 'T', 'T', 'T', 'C'],
  w2: ['T', 'T', 'T', 'S', 'C'],
  w3: ['T', 'T', 'S', 'S', 'C'],
  w4: ['T', 'S', 'S', 'S', 'C'],
  w5: ['T', 'S', 'S', 'C', 'C'],
};

function windowIndex(window) {
  return WINDOWS.indexOf(window) + 1;
}

// B's widening: clause 2 from w3, clause 3 from w5, in every type.
export function bExtraService(window, clauseIdx) {
  const w = windowIndex(window);
  if (clauseIdx === 2) return w >= 3;
  if (clauseIdx === 3) return w >= 5;
  return false;
}

const TITLES = {
  T: ['早市占道与噪音', '消防通道与照明', '门禁与消防栓', '清运与摊位管理', '夜间噪音与安全'],
  S: ['建议划设非机动车位', '建议公开费用明细', '建议翻新活动区', '建议错峰临停', '建议增设垃圾桶'],
  C: ['咨询停车费标准', '咨询绿化养护比例', '咨询摊位费收取', '咨询门禁维修', '咨询调价流程'],
};

function titleFor(type, pos) {
  return TITLES[type][pos % TITLES[type].length];
}

let docCounter = 0;
export const DOCS = [];

for (const window of WINDOWS) {
  WINDOW_MIX[window].forEach((type, pos) => {
    docCounter += 1;
    const id = `D${String(docCounter).padStart(2, '0')}`;
    const revision = id === 'D12' ? REVISION_SPEC() : null;
    const clauses = revision ? REVISION_CLAUSES() : [];
    for (let c = 0; c < (revision ? 0 : 5); c++) {
      const bank = BANK[type][c];
      const pick = (windowIndex(window) * 3 + pos + c) % bank.length;
      const text = bank[pick];
      const aTopics = [...BASE_TOPICS[type][c]];
      const bTopics = [...BASE_TOPICS[type][c]];
      const flags = {};
      // Deliberate, time-invariant topic disagreement: the first document of each
      // window has A add `safety` to the green clause. Constant per window, so it
      // does not create drift; it does create genuine topic disagreement.
      if (pos === 0 && c === 3) aTopics.push('safety');
      if (BASE_TOPICS[type][c].length > 1) flags.bSplit = true;
      // B's systematic widening (service boundary cases).
      if (bExtraService(window, c) && !bTopics.includes('service')) {
        bTopics.push('service');
        flags.widened = true;
      }
      // A merges clause 1 upward for some documents; this changes segmentation
      // only, since merged spans union their topics.
      if (c === 1 && (pos + windowIndex(window)) % 2 === 0) flags.aJoin = true;
      clauses.push([text, aTopics, bTopics, flags]);
    }
    DOCS.push({
      id,
      window,
      date: dateFor(window, pos),
      type: revision ? 'T' : type,
      typeLabel: TYPE_LABEL[revision ? 'T' : type],
      title: titleFor(type, pos),
      clauses,
      ...(revision ? { revision } : {}),
    });
  });
}

// The revision demo document is D12 (w3). It is built so that every migration
// status occurs at least once:
//
//   A  safety            exact    untouched at the head of the document
//   B  safety            lost     the whole sentence is deleted
//   C  parking+safety    partial  a clause is inserted inside the span
//   X  green             ambiguous the sentence now appears twice
//   F  safety+service    partial  text deleted and inserted inside
//   G  service           shifted  moved, content identical
function REVISION_CLAUSES() {
  return [
    ['门禁坏了以后，快递都堆在一楼大厅，谁都能拿走。', ['safety'], ['safety'], {}],
    ['门禁坏了以后，外卖员进出反而方便，但安全问题没有人负责。', ['safety'], ['safety'], { aJoin: true }],
    ['有人把消防栓前面当成了停车位，我看着很担心。', ['parking', 'safety'], ['parking', 'safety'], { bSplit: true }],
    ['绿化带的围栏倒了一段，一直没有人修。', ['green'], ['green'], {}],
    ['物业说门禁的配件要等厂家发货，可是消防通道不能等。', ['safety', 'service'], ['safety'], {}],
    ['希望物业把维修进度贴到公告栏，我们愿意配合登记。', ['service'], ['service'], {}],
  ];
}

function REVISION_SPEC() {
  return {
    version: 'v2',
    note: '示例修订：插入两句、删除整句、重复一句、改写两句。',
    ops: [
      { keep: [0, 1] },
      { insert: '有业主提议先装一个临时的刷卡门，费用从公共收益里出。' },
      { delete: [1, 2] },
      { replace: [2, 3], text: '有人把消防栓前面当成了停车位，我在群里问过物业，我看着很担心。' },
      { keep: [3, 4] },
      { insert: '同样的问题在三号楼也出现过。' },
      { duplicate: [3, 4] },
      { replace: [4, 5], text: '物业说门禁的配件要等厂家发货，具体时间他们也不清楚。' },
      { keep: [5, 6] },
    ],
  };
}

function dateFor(window, pos) {
  const w = windowIndex(window);
  const day = 1 + (w - 1) * 7 + pos;
  const d = new Date(Date.UTC(2026, 8, day));
  return d.toISOString().slice(0, 10);
}


// Keep a stable type ordering for display.
DOCS.sort((a, b) => a.id.localeCompare(b.id));
