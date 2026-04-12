import { useEffect, useMemo, useState } from 'react'
import Tesseract from 'tesseract.js'

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

const STORAGE_KEYS = {
  division: 'are-study-selected-division',
  room: 'are-study-selected-room',
  notes: 'are-study-notes-map',
  savedAt: 'are-study-last-saved-at',
  wrongAnswerText: 'are-study-wrong-answer-text',
  wrongAnswerCards: 'are-study-wrong-answer-cards',
}

function getNoteKey(division, room) {
  return `${division}__${room}`
}

function getInitialDivision() {
  const saved = localStorage.getItem(STORAGE_KEYS.division)
  return saved && palaceData[saved] ? saved : 'PPD'
}

function getInitialRoom(division) {
  const saved = localStorage.getItem(STORAGE_KEYS.room)
  return saved && palaceData[division].rooms.includes(saved)
    ? saved
    : palaceData[division].rooms[0]
}

function getStoredNotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notes)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function getStoredCards() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.wrongAnswerCards)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function getInitialNote(division, room) {
  const notesMap = getStoredNotes()
  const savedNote = notesMap[getNoteKey(division, room)]
  return savedNote ?? palaceData[division].starter
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

function summarizeWrongAnswer(text, division, room) {
  const clean = text.trim()
  if (!clean) return null

  const normalized = clean.replace(/\r/g, '')
  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const ignoredPatterns = [
    /^question[:：]?/i,
    /^reference[:：]?/i,
    /^which of the following/i,
    /^an architect is working/i,
    /^check the four/i,
  ]

  const options = []
  let currentOption = null

  function cleanOptionLabel(line) {
    return line
      .replace(/^[•\-✓✔☐☑■□]+\s*/, '')
      .replace(/^[A-D][\.\)]\s*/, '')
      .replace(/\.$/, '')
      .trim()
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const nextLine = lines[i + 1] || ''

    if (ignoredPatterns.some((pattern) => pattern.test(line))) {
      continue
    }

    if (/^reference[:：]?/i.test(line)) {
      break
    }

    if (/^(correct|incorrect)\b/i.test(line) && currentOption) {
      currentOption.status = /^correct/i.test(line) ? 'correct' : 'incorrect'
      currentOption.explanations.push(
        line.replace(/^(correct|incorrect)[\.:]?\s*/i, '').trim()
      )
      continue
    }

    const looksLikeOption =
      !/^(correct|incorrect)\b/i.test(line) &&
      /^(correct|incorrect)\b/i.test(nextLine) &&
      line.length < 140

    if (looksLikeOption) {
      currentOption = {
        label: cleanOptionLabel(line),
        status: 'unknown',
        explanations: [],
      }
      options.push(currentOption)
      continue
    }

    if (currentOption && currentOption.status !== 'unknown') {
      currentOption.explanations.push(line)
    }
  }

  const correctOptions = options.filter((item) => item.status === 'correct')
  const incorrectOptions = options.filter((item) => item.status === 'incorrect')

  const correctAnswer = correctOptions.length
    ? correctOptions.map((item) => item.label).join(' / ')
    : '未明确识别，请手动补充正确答案。'

  const whyRight = correctOptions.length
    ? correctOptions
        .map((item) => {
          const explanation = item.explanations.join(' ').trim()
          return `${item.label}: ${explanation}`
        })
        .join(' ')
    : '没有稳定识别到正确选项，请手动检查 OCR 结果。'

  const trapPoint = incorrectOptions.length
    ? incorrectOptions
        .map((item) => {
          const explanation = item.explanations.join(' ').trim()
          return `${item.label}: ${explanation}`
        })
        .join(' ')
    : '目前没有稳定识别到错误选项解释。'

  const keyPoints = []

  if (/prefabricat/i.test(clean)) {
    keyPoints.push('预制构件通常对应减少现场切割、减少施工废料和现场污染。')
  }
  if (/recycled/i.test(clean)) {
    keyPoints.push('高 recycled content 常对应减少新原材料开采。')
  }
  if (/smart technology|smart thermostat|occupancy sensor|automation/i.test(clean)) {
    keyPoints.push('smart technology 更偏建筑运营效率和 performance。')
  }
  if (/high-?voc|low-?voc/i.test(clean)) {
    keyPoints.push('VOC 题先分清方向，通常 low VOC 才是可持续方向。')
  }
  if (/field finishing|factory/i.test(clean)) {
    keyPoints.push('减少现场 finishing、转向工厂完成，通常有助于减少污染物和粉尘。')
  }

  if (keyPoints.length === 0) {
    keyPoints.push('先判断题干真正目标，再筛选哪些选项直接服务这个目标。')
    keyPoints.push('不要只背正确项，也要记为什么其他项错。')
    keyPoints.push('把这题归进固定房间，后面复习更容易提取。')
  }

  const memoryHook =
    correctOptions.length > 1
      ? '多选题先抓题干目标，再逐项筛掉“听起来不错但不直接服务目标”的选项。'
      : '先抓题干目标，再找最直接满足目标的选项。'

  return {
    correctAnswer,
    whyRight,
    trapPoint,
    topicGuess: `${division} → ${room}`,
    keyPoints,
    memoryHook,
  }
}

export default function App() {
  const [selectedDivision, setSelectedDivision] = useState(() => getInitialDivision())
  const [selectedRoom, setSelectedRoom] = useState(() =>
    getInitialRoom(getInitialDivision())
  )
  const [note, setNote] = useState(() =>
    getInitialNote(getInitialDivision(), getInitialRoom(getInitialDivision()))
  )
  const [lastSavedAt, setLastSavedAt] = useState(
    () => localStorage.getItem(STORAGE_KEYS.savedAt) || ''
  )

  const [wrongAnswerText, setWrongAnswerText] = useState(
    () => localStorage.getItem(STORAGE_KEYS.wrongAnswerText) || ''
  )
  const [wrongAnswerImage, setWrongAnswerImage] = useState(null)
  const [wrongAnswerSummary, setWrongAnswerSummary] = useState(null)
  const [savedWrongCards, setSavedWrongCards] = useState(() => getStoredCards())
  const [expandedCardId, setExpandedCardId] = useState(null)

  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrError, setOcrError] = useState('')

  const currentRooms = palaceData[selectedDivision].rooms

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.division, selectedDivision)
  }, [selectedDivision])

  useEffect(() => {
    if (!currentRooms.includes(selectedRoom)) {
      const firstRoom = currentRooms[0]
      setSelectedRoom(firstRoom)
      return
    }

    localStorage.setItem(STORAGE_KEYS.room, selectedRoom)
    const notesMap = getStoredNotes()
    const storedNote = notesMap[getNoteKey(selectedDivision, selectedRoom)]
    setNote(storedNote ?? palaceData[selectedDivision].starter)
  }, [selectedDivision, selectedRoom, currentRooms])

  useEffect(() => {
    const timer = setTimeout(() => {
      const notesMap = getStoredNotes()
      notesMap[getNoteKey(selectedDivision, selectedRoom)] = note
      localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

      const savedTime = new Date().toLocaleString()
      localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
      setLastSavedAt(savedTime)
    }, 400)

    return () => clearTimeout(timer)
  }, [note, selectedDivision, selectedRoom])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wrongAnswerText, wrongAnswerText)
  }, [wrongAnswerText])

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEYS.wrongAnswerCards,
      JSON.stringify(savedWrongCards)
    )
  }, [savedWrongCards])

  const result = useMemo(() => {
    return extractData(note, selectedDivision, selectedRoom)
  }, [note, selectedDivision, selectedRoom])

  function handleManualSave() {
    const notesMap = getStoredNotes()
    notesMap[getNoteKey(selectedDivision, selectedRoom)] = note
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

    const savedTime = new Date().toLocaleString()
    localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
    setLastSavedAt(savedTime)
  }

  function handleLoadSample() {
    setNote(palaceData[selectedDivision].starter)
  }

  function handleClear() {
    setNote('')
    const notesMap = getStoredNotes()
    notesMap[getNoteKey(selectedDivision, selectedRoom)] = ''
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notesMap))

    const savedTime = new Date().toLocaleString()
    localStorage.setItem(STORAGE_KEYS.savedAt, savedTime)
    setLastSavedAt(savedTime)
  }

  function handleWrongAnswerImageChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onloadend = () => {
      setWrongAnswerImage(reader.result)
      setOcrError('')
      setOcrStatus('')
      setOcrProgress(0)
    }
    reader.readAsDataURL(file)
  }

  async function handleRunOCR() {
    if (!wrongAnswerImage) {
      alert('请先上传题目截图。')
      return
    }

    try {
      setOcrLoading(true)
      setOcrError('')
      setOcrStatus('Starting OCR...')
      setOcrProgress(0)

      const result = await Tesseract.recognize(wrongAnswerImage, 'eng', {
        logger: (message) => {
          if (message.status) {
            setOcrStatus(message.status)
          }
          if (typeof message.progress === 'number') {
            setOcrProgress(Math.round(message.progress * 100))
          }
        },
      })

      const extractedText = result?.data?.text?.trim() || ''
      setWrongAnswerText(extractedText)

      if (extractedText) {
        const summary = summarizeWrongAnswer(
          extractedText,
          selectedDivision,
          selectedRoom
        )
        setWrongAnswerSummary(summary)
      }

      setOcrStatus('OCR finished')
      setOcrProgress(100)
    } catch (error) {
      console.error(error)
      setOcrError('OCR 失败了。你可以重试，或者先手动把文字粘进右边文本框。')
    } finally {
      setOcrLoading(false)
    }
  }

  function handleAnalyzeWrongAnswer() {
    if (!wrongAnswerText.trim()) {
      alert('请先上传图片做 OCR，或者先把题目、答案和解析文字粘贴到右边文本框里。')
      return
    }

    const summary = summarizeWrongAnswer(
      wrongAnswerText,
      selectedDivision,
      selectedRoom
    )
    setWrongAnswerSummary(summary)
  }

  function handleLoadWrongAnswerSample() {
    const sample = `Question:
Which strategy is most appropriate for reducing heat loss in a cold climate building?

Utilize prefabricated building elements.
Correct. By utilizing prefabricated building elements, there is less field-cutting of materials and job site waste can be decreased.

Utilize local labor.
Incorrect. While it is always beneficial to utilize local labor, it does not specifically contribute to the client's goal of a sustainable project.

Select products with high recycled content.
Correct. By selecting products with high recycled content, fewer raw materials need to be harvested.

Utilize smart technology.
Correct. Utilizing smart technology within the building is a great way to allow for the property to be more efficient in its operation.

Specify high-VOC paint.
Incorrect. Specifying low-VOC paint would help the client achieve their goal of a sustainable project.

Minimize field finishing of materials.
Correct. By finishing materials in the factory, the contaminants in the air on the job site can be reduced.`

    setWrongAnswerText(sample)
    setWrongAnswerSummary(
      summarizeWrongAnswer(sample, selectedDivision, selectedRoom)
    )
  }

  function handleSaveToFlashcards() {
    if (!wrongAnswerSummary) {
      alert('请先分析这道题，再保存成 flashcard。')
      return
    }

    const newCard = {
      id: Date.now(),
      rawText: wrongAnswerText,
      division: selectedDivision,
      room: selectedRoom,
      savedAt: new Date().toLocaleString(),
      summary: wrongAnswerSummary,
    }

    setSavedWrongCards((prev) => [newCard, ...prev])
    setExpandedCardId(newCard.id)
  }

  function handleClearCurrentWrongAnswer() {
    setWrongAnswerImage(null)
    setWrongAnswerText('')
    setWrongAnswerSummary(null)
    setOcrStatus('')
    setOcrProgress(0)
    setOcrError('')
    localStorage.removeItem(STORAGE_KEYS.wrongAnswerText)
  }

  function handleDeleteCard(id) {
    setSavedWrongCards((prev) => prev.filter((card) => card.id !== id))
    if (expandedCardId === id) {
      setExpandedCardId(null)
    }
  }

  function toggleCard(id) {
    setExpandedCardId((prev) => (prev === id ? null : id))
  }

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
            <span className="status-tag light">
              {lastSavedAt ? `Saved: ${lastSavedAt}` : 'Not saved yet'}
            </span>
          </div>

          <textarea
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paste your ARE notes here..."
          />

          <div className="action-row">
            <button className="small-action" onClick={handleManualSave}>
              Save Note
            </button>

            <button className="small-action" onClick={handleLoadSample}>
              Load {selectedDivision} Sample
            </button>

            <button className="small-action ghost" onClick={handleClear}>
              Clear
            </button>
          </div>

          <div className="hint-box">
            现在这版已经支持本地保存。刷新页面后，当前浏览器里的内容会自动恢复。
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

        <section className="panel big-panel">
          <div className="section-title">Wrong Answer Lab</div>
          <div className="section-subtitle">
            先上传题目截图，先做 OCR 提字，再做错题分析，最后保存成 flashcard。
          </div>

          <div className="wrong-answer-grid">
            <div>
              <label className="upload-box">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleWrongAnswerImageChange}
                  className="hidden-input"
                />
                <span>Upload Question Image</span>
              </label>

              {wrongAnswerImage ? (
                <img
                  src={wrongAnswerImage}
                  alt="Wrong answer preview"
                  className="wrong-answer-image"
                />
              ) : (
                <div className="image-placeholder">
                  上传题目截图后，这里会显示预览。
                </div>
              )}

              <div
                style={{
                  marginTop: '14px',
                  display: 'grid',
                  gap: '10px',
                }}
              >
                <button
                  className="small-action"
                  onClick={handleRunOCR}
                  disabled={ocrLoading || !wrongAnswerImage}
                  style={{
                    opacity: ocrLoading || !wrongAnswerImage ? 0.6 : 1,
                    cursor: ocrLoading || !wrongAnswerImage ? 'not-allowed' : 'pointer',
                  }}
                >
                  {ocrLoading ? 'Reading Image...' : 'OCR Image to Text'}
                </button>

                {(ocrStatus || ocrError || ocrLoading) && (
                  <div
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '16px',
                      padding: '12px',
                      background: '#fafafa',
                    }}
                  >
                    {ocrStatus && (
                      <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                        OCR Status: {ocrStatus}
                      </div>
                    )}

                    {(ocrLoading || ocrProgress > 0) && (
                      <div
                        style={{
                          width: '100%',
                          height: '10px',
                          background: '#e5e7eb',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          marginBottom: '8px',
                        }}
                      >
                        <div
                          style={{
                            width: `${ocrProgress}%`,
                            height: '100%',
                            background: '#111827',
                          }}
                        />
                      </div>
                    )}

                    {(ocrLoading || ocrProgress > 0) && (
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        {ocrProgress}% complete
                      </div>
                    )}

                    {ocrError && (
                      <div style={{ fontSize: '14px', color: '#b91c1c' }}>
                        {ocrError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <textarea
                className="note-input wrong-answer-textarea"
                value={wrongAnswerText}
                onChange={(e) => setWrongAnswerText(e.target.value)}
                placeholder="OCR result will appear here. You can also edit it manually before analyzing."
              />

              <div className="action-row">
                <button className="small-action" onClick={handleAnalyzeWrongAnswer}>
                  Extract Mistake Summary
                </button>

                <button
                  className="small-action ghost"
                  onClick={handleLoadWrongAnswerSample}
                >
                  Load Sample
                </button>

                <button className="small-action" onClick={handleSaveToFlashcards}>
                  Save to Flashcards
                </button>

                <button
                  className="small-action ghost"
                  onClick={handleClearCurrentWrongAnswer}
                >
                  Clear Current
                </button>
              </div>
            </div>
          </div>

          {wrongAnswerSummary && (
            <div className="wrong-answer-result">
              <div className="card soft">
                <div className="card-title">Correct Answer</div>
                <div className="card-text">{wrongAnswerSummary.correctAnswer}</div>
              </div>

              <div className="card-grid three-col">
                <div className="card">
                  <div className="card-title">Why It Is Right</div>
                  <div className="card-text">{wrongAnswerSummary.whyRight}</div>
                </div>

                <div className="card">
                  <div className="card-title">Trap Point</div>
                  <div className="card-text">{wrongAnswerSummary.trapPoint}</div>
                </div>

                <div className="card">
                  <div className="card-title">ARE Topic</div>
                  <div className="card-text">{wrongAnswerSummary.topicGuess}</div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Key Points to Remember</div>
                <ul className="key-points-list">
                  {wrongAnswerSummary.keyPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              </div>

              <div className="card">
                <div className="card-title">Memory Hook</div>
                <div className="card-text">{wrongAnswerSummary.memoryHook}</div>
              </div>
            </div>
          )}
        </section>

        <section className="panel big-panel">
          <div className="section-title">Wrong Answer Flashcards</div>
          <div className="section-subtitle">
            分析完成后保存到这里，慢慢累积成你的错题记忆卡片库。
          </div>

          {savedWrongCards.length === 0 ? (
            <div className="image-placeholder">
              还没有保存的 flashcards。先分析一题，再点 Save to Flashcards。
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: '16px',
                marginTop: '16px',
              }}
            >
              {savedWrongCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '20px',
                    background: '#fff',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      flexWrap: 'wrap',
                      marginBottom: '10px',
                    }}
                  >
                    <span
                      style={{
                        background: '#eef2ff',
                        color: '#3730a3',
                        borderRadius: '999px',
                        padding: '6px 10px',
                        fontSize: '12px',
                      }}
                    >
                      {card.division}
                    </span>
                    <span
                      style={{
                        background: '#eef2ff',
                        color: '#3730a3',
                        borderRadius: '999px',
                        padding: '6px 10px',
                        fontSize: '12px',
                      }}
                    >
                      {card.room}
                    </span>
                  </div>

                  <div style={{ fontWeight: 700, marginBottom: '8px' }}>
                    {card.summary.correctAnswer}
                  </div>

                  <div
                    style={{
                      color: '#6b7280',
                      fontSize: '13px',
                      marginBottom: '12px',
                    }}
                  >
                    Saved: {card.savedAt}
                  </div>

                  <div className="flashcard-actions">
                    <button
                      className="small-action"
                      onClick={() => toggleCard(card.id)}
                    >
                      {expandedCardId === card.id ? 'Hide' : 'View'}
                    </button>

                    <button
                      className="small-action ghost"
                      onClick={() => handleDeleteCard(card.id)}
                    >
                      Delete
                    </button>
                  </div>

                  {expandedCardId === card.id && (
                    <div
                      style={{
                        marginTop: '14px',
                        display: 'grid',
                        gap: '12px',
                      }}
                    >
                      <div className="card soft">
                        <div className="card-title">Why It Is Right</div>
                        <div className="card-text">{card.summary.whyRight}</div>
                      </div>

                      <div className="card soft">
                        <div className="card-title">Trap Point</div>
                        <div className="card-text">{card.summary.trapPoint}</div>
                      </div>

                      <div className="card soft">
                        <div className="card-title">Memory Hook</div>
                        <div className="card-text">{card.summary.memoryHook}</div>
                      </div>

                      <div className="card soft">
                        <div className="card-title">Key Points</div>
                        <ul className="key-points-list">
                          {card.summary.keyPoints.map((point, index) => (
                            <li key={index}>{point}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="card soft">
                        <div className="card-title">Raw OCR Text</div>
                        <div className="card-text">{card.rawText}</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
