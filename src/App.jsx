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

function parseWrongAnswerBlocks(text) {
  const clean = text.trim()
  if (!clean) return []

  const lines = clean
    .replace(/\r/g, '')
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

  function cleanOptionLabel(line) {
    return line
      .replace(/^[•\-✓✔☐☑■□]+\s*/, '')
      .replace(/^[A-D][\.\)]\s*/, '')
      .replace(/\.$/, '')
      .trim()
  }

  const blocks = []
  let currentBlock = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const nextLine = lines[i + 1] || ''

    if (/^reference[:：]?/i.test(line)) {
      break
    }

    if (ignoredPatterns.some((pattern) => pattern.test(line))) {
      continue
    }

    const isStatusLine = /^(correct|incorrect)\b/i.test(line)
    const nextIsStatusLine = /^(correct|incorrect)\b/i.test(nextLine)

    if (!isStatusLine && nextIsStatusLine && line.length < 150) {
      currentBlock = {
        label: cleanOptionLabel(line),
        status: 'unknown',
        explanation: '',
      }
      blocks.push(currentBlock)
      continue
    }

    if (isStatusLine && currentBlock) {
      currentBlock.status = /^correct/i.test(line) ? 'correct' : 'incorrect'
      currentBlock.explanation = line
        .replace(/^(correct|incorrect)[\.:]?\s*/i, '')
        .trim()
      continue
    }

    if (currentBlock && currentBlock.status !== 'unknown') {
      currentBlock.explanation = `${currentBlock.explanation} ${line}`.trim()
    }
  }

  return blocks
}

function buildWhyRightSummary(correctBlocks, clean) {
  const themes = []

  if (/prefabricat/i.test(clean)) {
    themes.push('减少现场切割、施工废料和现场污染')
  }
  if (/recycled/i.test(clean)) {
    themes.push('减少新原材料开采')
  }
  if (/smart technology|smart thermostat|occupancy sensor|automation/i.test(clean)) {
    themes.push('提升建筑运行效率和 performance')
  }
  if (/field finishing|factory/i.test(clean)) {
    themes.push('减少现场 VOC、粉尘和污染物')
  }
  if (/low-?voc/i.test(clean)) {
    themes.push('降低有害排放')
  }

  if (themes.length > 0) {
    return `这些正确选项共同点是：它们都直接服务题干目标，比如 ${themes.join('、')}。`
  }

  if (correctBlocks.length > 0) {
    return correctBlocks
      .map((item) => `${item.label}: ${item.explanation}`)
      .join(' ')
  }

  return '没有稳定识别到正确选项，请先检查 OCR 文本。'
}

function simplifyTrapReason(block) {
  const label = block.label || ''
  const explanation = block.explanation || ''
  const lower = `${label} ${explanation}`.toLowerCase()

  if (
    lower.includes("doesn't specifically contribute") ||
    lower.includes('does not specifically contribute')
  ) {
    return '不直接回应题干目标。'
  }

  if (lower.includes('high-voc') || lower.includes('high voc')) {
    return '方向反了，这题应避免 high-VOC。'
  }

  if (lower.includes('local labor')) {
    return '听起来是好事，但不直接服务 sustainability 目标。'
  }

  if (lower.includes('goal')) {
    return '没有直接服务题干目标。'
  }

  return '看起来合理，但不属于这题真正要筛选的方向。'
}

function buildMemoryHook(clean, correctBlocks) {
  const lower = clean.toLowerCase()
  const hooks = []

  if (lower.includes('sustainable') || lower.includes('recycled') || lower.includes('voc')) {
    hooks.push('看到 sustainable materials / practices，要优先找减少 waste、减少 virgin materials、减少污染、提升运行效率的选项。')
  }

  if (lower.includes('cold climate') || lower.includes('heat loss')) {
    hooks.push('看到 cold climate / heat loss，先想保温、减少热损失、利用 solar gain。')
  }

  if (lower.includes('hot climate') || lower.includes('heat gain')) {
    hooks.push('看到 hot climate / heat gain，先想遮阳、通风、控制热增益。')
  }

  if (lower.includes('voc')) {
    hooks.push('看到 VOC，先判断方向，通常 low-VOC 才是可持续方向。')
  }

  if (correctBlocks.length > 1) {
    hooks.push('多选题先抓题干目标，再逐项筛掉“听起来不错但不直接服务目标”的选项。')
  }

  if (hooks.length === 0) {
    return '先抓题干目标，再判断哪个选项最直接满足它。'
  }

  return hooks.join(' ')
}

function summarizeWrongAnswer(text, division, room) {
  const clean = text.trim()
  if (!clean) return null

  const blocks = parseWrongAnswerBlocks(clean)
  const correctBlocks = blocks.filter((item) => item.status === 'correct')
  const incorrectBlocks = blocks.filter((item) => item.status === 'incorrect')

  const correctAnswer = correctBlocks.length
    ? correctBlocks.map((item) => item.label).join(' / ')
    : '未明确识别，请手动补充正确答案。'

  const whyRight = buildWhyRightSummary(correctBlocks, clean)

  const trapPoint = incorrectBlocks.length
    ? incorrectBlocks
        .slice(0, 2)
        .map((item) => simplifyTrapReason(item))
        .join(' ')
    : '最容易错在只看表面关键词，没有先抓题干真正目标。'

  const memoryHook = buildMemoryHook(clean, correctBlocks)

  return {
    correctAnswer,
    whyRight,
    trapPoint,
    topicGuess: `${division} → ${room}`,
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
  const [showDebugPreview, setShowDebugPreview] = useState(false)

  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrStatus, setOcrStatus] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrError, setOcrError] = useState('')

  const currentRooms = palaceData[selectedDivision].rooms
  const parsedBlocks = useMemo(
    () => parseWrongAnswerBlocks(wrongAnswerText),
    [wrongAnswerText]
  )

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

      const ocrResult = await Tesseract.recognize(wrongAnswerImage, 'eng', {
        logger: (message) => {
          if (message.status) setOcrStatus(message.status)
          if (typeof message.progress === 'number') {
            setOcrProgress(Math.round(message.progress * 100))
          }
        },
      })

      const extractedText = ocrResult?.data?.text?.trim() || ''
      setWrongAnswerText(extractedText)
      setWrongAnswerSummary(null)
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
      image: wrongAnswerImage || '',
      rawText: wrongAnswerText,
      division: selectedDivision,
      room: selectedRoom,
      savedAt: new Date().toLocaleString(),
      summary: wrongAnswerSummary,
      parsedBlocks,
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

              <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
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

          {parsedBlocks.length > 0 && (
            <div className="wrong-answer-result">
              <div className="card soft">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div className="card-title">Debug Parse Preview</div>
                  <button
                    className="small-action ghost"
                    onClick={() => setShowDebugPreview((prev) => !prev)}
                  >
                    {showDebugPreview ? 'Hide Debug' : 'Show Debug'}
                  </button>
                </div>

                {showDebugPreview && (
                  <div
                    style={{
                      display: 'grid',
                      gap: '10px',
                      marginTop: '12px',
                    }}
                  >
                    {parsedBlocks.map((block, index) => (
                      <div
                        key={`${block.label}-${index}`}
                        style={{
                          border: '1px solid #e5e7eb',
                          borderRadius: '14px',
                          padding: '12px',
                          background: '#fff',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                            marginBottom: '8px',
                            alignItems: 'center',
                          }}
                        >
                          <strong>{block.label}</strong>
                          <span
                            style={{
                              fontSize: '12px',
                              borderRadius: '999px',
                              padding: '4px 8px',
                              background:
                                block.status === 'correct'
                                  ? '#dcfce7'
                                  : block.status === 'incorrect'
                                  ? '#fee2e2'
                                  : '#e5e7eb',
                              color:
                                block.status === 'correct'
                                  ? '#166534'
                                  : block.status === 'incorrect'
                                  ? '#991b1b'
                                  : '#374151',
                            }}
                          >
                            {block.status}
                          </span>
                        </div>
                        <div className="card-text">
                          {block.explanation || 'No explanation detected.'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {wrongAnswerSummary && (
            <div className="wrong-answer-result">
              <div className="card soft">
                <div className="card-title">Correct Answers</div>
                <div className="card-text">{wrongAnswerSummary.correctAnswer}</div>
              </div>

              <div className="card-grid three-col">
                <div className="card">
                  <div className="card-title">Why These Are Right</div>
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
            <div style={{ display: 'grid', gap: '16px', marginTop: '16px' }}>
              {savedWrongCards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '20px',
                    background: '#fff',
                    overflow: 'hidden',
                  }}
                >
                  {card.image ? (
                    <img
                      src={card.image}
                      alt="Saved flashcard"
                      style={{
                        width: '100%',
                        maxHeight: '220px',
                        objectFit: 'cover',
                        display: 'block',
                        background: '#f3f4f6',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        minHeight: '120px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        background: '#f9fafb',
                      }}
                    >
                      No Image
                    </div>
                  )}

                  <div style={{ padding: '16px' }}>
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
                      <div style={{ marginTop: '14px', display: 'grid', gap: '12px' }}>
                        <div className="card soft">
                          <div className="card-title">Correct Answers</div>
                          <div className="card-text">{card.summary.correctAnswer}</div>
                        </div>

                        <div className="card soft">
                          <div className="card-title">Why These Are Right</div>
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

                        {card.parsedBlocks?.length > 0 && (
                          <div className="card soft">
                            <div className="card-title">Debug Parse Preview</div>
                            <div style={{ display: 'grid', gap: '10px', marginTop: '12px' }}>
                              {card.parsedBlocks.map((block, index) => (
                                <div
                                  key={`${block.label}-${index}`}
                                  style={{
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '14px',
                                    padding: '12px',
                                    background: '#fff',
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: '8px',
                                      flexWrap: 'wrap',
                                      marginBottom: '8px',
                                      alignItems: 'center',
                                    }}
                                  >
                                    <strong>{block.label}</strong>
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        borderRadius: '999px',
                                        padding: '4px 8px',
                                        background:
                                          block.status === 'correct'
                                            ? '#dcfce7'
                                            : block.status === 'incorrect'
                                            ? '#fee2e2'
                                            : '#e5e7eb',
                                      }}
                                    >
                                      {block.status}
                                    </span>
                                  </div>
                                  <div className="card-text">{block.explanation}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="card soft">
                          <div className="card-title">Raw OCR Text</div>
                          <div className="card-text">{card.rawText}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
