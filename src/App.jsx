import { useEffect, useMemo, useState } from 'react'

const palaceData = {
  PA: {
    rooms: ['Site Analysis', 'Codes', 'Programming', 'Environmental Context'],
    starter:
      'Programming and analysis notes go here. Think about site conditions, zoning, adjacency, and early project constraints.',
  },
  PPD: {
    rooms: ['Site', 'Climate', 'Structure', 'Mechanical', 'Envelope', 'Codes'],
    starter:
      'Building system: active system relies on mechanical equipment and uses more energy. Passive system relies on sun, air, and wind flow. In cold climate, reduce heat loss and gain solar heat. In hot climate, control heat gain and optimize natural ventilation. Trombe wall helps stabilize temperature but takes more space.',
  },
  PDD: {
    rooms: ['Assemblies', 'Detailing', 'Specifications', 'Coordination'],
    starter:
      'Detailing notes go here. Think about wall assemblies, membranes, flashing, thermal continuity, specifications, and coordination between systems.',
  },
  PCM: {
    rooms: ['Practice Ops', 'Risk', 'Finance'],
    starter:
      'Practice management notes go here. Think about firm operations, liability, staffing, billing, and financial planning.',
  },
  PJM: {
    rooms: ['Contracts', 'Bidding', 'Construction Admin'],
    starter:
      'Project management notes go here. Think about scope, schedule, consultant coordination, bidding, and CA workflows.',
  },
  CE: {
    rooms: ['Site Visits', 'Documentation', 'Observation Reports'],
    starter:
      'Construction evaluation notes go here. Think about field reports, submittals, RFIs, observations, and closeout.',
  },
}

function extractData(text, selectedDivision, selectedRoom) {
  const clean = text.trim()

  if (!clean) {
    return {
      summary: '还没有内容，先把你的视频笔记、手写转录内容或课堂总结贴进来。',
      chunks: [],
      links: [],
      locations: [`${selectedDivision} → ${selectedRoom}`],
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

  const locations = [
    `${selectedDivision} → ${selectedRoom}`,
    `${selectedDivision} → Core Concepts`,
    `${selectedDivision} → Review`,
  ]

  const summary = `当前定位：${selectedDivision} / ${selectedRoom}。这个页面会把原始笔记先收进来，再自动拆成小知识块、关系和建议归类位置。`

  return { summary, chunks, links, locations }
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState('PPD')
  const [selectedRoom, setSelectedRoom] = useState(palaceData['PPD'].rooms[0])
  const [note, setNote] = useState(palaceData['PPD'].starter)

  const currentRooms = palaceData[selectedDivision].rooms

  useEffect(() => {
    setSelectedRoom(palaceData[selectedDivision].rooms[0])
  }, [selectedDivision])

  const result = useMemo(() => {
    return extractData(note, selectedDivision, selectedRoom)
  }, [note, selectedDivision, selectedRoom])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="panel">
          <div className="panel-title">ARE Study Vault</div>
          <div className="panel-subtitle">空间结构 + 自动分块</div>
        </div>

        <div className="panel">
          <div className="section-title">Memory Palace</div>
          {Object.keys(palaceData).map((division) => (
            <button
              key={division}
              className={`pill ${selectedDivision === division ? 'active' : ''}`}
              onClick={() => setSelectedDivision(division)}
            >
              {division}
            </button>
          ))}
        </div>

        <div className="panel">
          <div className="section-title">{selectedDivision} Rooms</div>
          {currentRooms.map((room) => (
            <button
              key={room}
              className={`list-button ${selectedRoom === room ? 'active-room' : ''}`}
              onClick={() => setSelectedRoom(room)}
            >
              {room}
            </button>
          ))}
        </div>
      </aside>

      <main className="main-grid">
        <section className="panel big-panel">
          <div className="section-title">Capture</div>
          <div className="section-subtitle">
            把你的视频笔记、聊天整理、手写转录内容先丢进来。
          </div>

          <div className="status-row">
            <span className="status-tag">Division: {selectedDivision}</span>
            <span className="status-tag">Room: {selectedRoom}</span>
          </div>

          <textarea
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paste your ARE notes here..."
          />

          <div className="action-row">
            <button
              className="small-action"
              onClick={() => setNote(palaceData[selectedDivision].starter)}
            >
              Load {selectedDivision} Sample
            </button>

            <button className="small-action ghost" onClick={() => setNote('')}>
              Clear
            </button>
          </div>

          <div className="hint-box">
            现在这版已经支持点击 division 和 room。下一步可以继续加：
            自动保存、手写笔记上传、自动 OCR、自动连线、复习计划。
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
