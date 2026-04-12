import { useMemo, useState } from 'react'

const starterText =
  'Building system: active system relies on mechanical equipment and uses more energy. Passive system relies on sun, air, and wind flow. In cold climate, reduce heat loss and gain solar heat. In hot climate, control heat gain and optimize natural ventilation. Trombe wall helps stabilize temperature but takes more space.'

function extractData(text) {
  const clean = text.trim()

  if (!clean) {
    return {
      summary: '还没有内容，先把你的视频笔记、手写转录内容或课堂总结贴进来。',
      chunks: [],
      links: [],
      locations: [],
    }
  }

  const lower = clean.toLowerCase()
  const chunks = []

  if (lower.includes('active system')) {
    chunks.push({
      title: 'Active System',
      desc: '依赖机械设备，控制更强，但通常能耗更高。',
    })
  }

  if (lower.includes('passive system')) {
    chunks.push({
      title: 'Passive System',
      desc: '依赖太阳、空气和风等自然条件，通常更节能。',
    })
  }

  if (lower.includes('cold climate') || lower.includes('hot climate')) {
    chunks.push({
      title: 'Cold Climate vs Hot Climate',
      desc: '寒冷气候强调减少热损失，炎热气候强调控制热增益与通风。',
    })
  }

  if (lower.includes('trombe wall')) {
    chunks.push({
      title: 'Trombe Wall',
      desc: '一种被动式采暖策略，可稳定温度，但占空间。',
    })
  }

  if (chunks.length === 0) {
    clean
      .split(/[.!?]\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .forEach((item, index) => {
        chunks.push({
          title: `Note Chunk ${index + 1}`,
          desc: item,
        })
      })
  }

  const links = []
  if (lower.includes('passive system')) {
    links.push('Passive System → depends on → Sun / Air / Wind')
  }
  if (lower.includes('active system')) {
    links.push('Active System → relies on → Mechanical Equipment')
  }
  if (lower.includes('cold climate')) {
    links.push('Cold Climate → goal → Reduce Heat Loss')
  }
  if (lower.includes('hot climate')) {
    links.push('Hot Climate → goal → Control Heat Gain')
  }
  if (lower.includes('cold climate') && lower.includes('hot climate')) {
    links.push('Cold Climate ↔ contrasts with ↔ Hot Climate')
  }
  if (lower.includes('trombe wall')) {
    links.push('Trombe Wall → example of → Passive Strategy')
  }

  const locations = ['PPD → Climate', 'PPD → Systems', 'PPD → Site']

  const summary =
    '这个页面会把原始笔记先收进来，再自动拆成小知识块、关系和建议归类位置。第一版先做 typed note + 自动提炼，后面再接手写笔记上传和真正的知识图谱。'

  return { summary, chunks, links, locations }
}

export default function App() {
  const [note, setNote] = useState(starterText)

  const result = useMemo(() => extractData(note), [note])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel">
          <div className="panel-title">ARE Study Vault</div>
          <div className="panel-subtitle">空间结构 + 自动分块</div>
        </div>

        <div className="panel">
          <div className="section-title">Memory Palace</div>
          <div className="pill">PA</div>
          <div className="pill active">PPD</div>
          <div className="pill">PDD</div>
          <div className="pill">PCM</div>
          <div className="pill">PJM</div>
          <div className="pill">CE</div>
        </div>

        <div className="panel">
          <div className="section-title">PPD Rooms</div>
          <div className="list-item">Site</div>
          <div className="list-item">Climate</div>
          <div className="list-item">Structure</div>
          <div className="list-item">Mechanical</div>
          <div className="list-item">Envelope</div>
          <div className="list-item">Codes</div>
        </div>
      </aside>

      <main className="main-grid">
        <section className="panel big-panel">
          <div className="section-title">Capture</div>
          <div className="section-subtitle">
            把你的视频笔记、聊天整理、手写转录内容先丢进来。
          </div>

          <textarea
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paste your ARE notes here..."
          />

          <div className="hint-box">
            现在这版先支持 typed note。后面可以继续加：
            手写笔记上传、自动 OCR、自动连线、复习计划。
          </div>
        </section>

        <section className="panel">
          <div className="section-title">Extraction</div>
          <div className="card soft">
            <div className="card-title">Summary</div>
            <div className="card-text">{result.summary}</div>
          </div>

          <div className="card-grid">
            {result.chunks.map((chunk) => (
              <div className="card" key={chunk.title}>
                <div className="card-title">{chunk.title}</div>
                <div className="card-text">{chunk.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-title">Logic Links</div>
          {result.links.length === 0 ? (
            <div className="empty">还没有识别到关系。</div>
          ) : (
            result.links.map((item, index) => (
              <div className="list-item" key={index}>
                {item}
              </div>
            ))
          )}
        </section>

        <section className="panel">
          <div className="section-title">Suggested Placement</div>
          {result.locations.map((item, index) => (
            <div className="list-item" key={index}>
              {item}
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}