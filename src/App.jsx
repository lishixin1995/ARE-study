import React, { useState, useEffect, useMemo } from 'react';

// ==========================================
// 🧠 核心解析引擎 (更强悍的容错和正则)
// ==========================================

const splitLines = (text) => (text ? text.split('\n').filter(line => line.trim() !== '') : []);

// 提取带有明确标签的内容 (如 Question:, Memory Hook:)
const extractLabeledContent = (text, label) => {
  // 容忍各种标点符号、空格和换行
  const regex = new RegExp(`(?:${label})[\\s]*(?:[:：]|)[\\s]*([\\s\\S]*?)(?=(?:\\n(?:Question|Correct Answer|Summary|Trap Point|Memory Hook|Extraction)[\\s]*(?:[:：]|))|\\n(?:☑|✔|☐|❌|\\[x\\]|\\[ \\])?\\s*(?:Correct|Incorrect)\\b|$)`, 'i');
  const match = (text || "").match(regex);
  return match ? match[1].trim() : null;
};

// 终极智能解析器
const buildLiveAnalysis = (text) => {
  if (!text.trim()) return null;

  const allLines = splitLines(text);
  
  // 1. 抓取题目 (如果没有 Question 标签，默认前两行没标签的话就是题目)
  let question = extractLabeledContent(text, "Question|Q");
  if (!question && allLines.length > 0) {
    question = allLines.find(l => !/^(correct|incorrect|extraction|trap|memory|summary)/i.test(l)) || "No question detected.";
  }

  // 2. 抓取答案标签
  const answer = extractLabeledContent(text, "Correct Answer|Answer") || "Check options below";

  // 3. 智能抓取知识点 (寻找 Correct 开头或带标签的行)
  let extraction = extractLabeledContent(text, "Extraction|Answer Extraction");
  extraction = extraction ? splitLines(extraction) : [];
  if (extraction.length === 0) {
    // 匹配: "Correct.", "Correct:", "☑ Correct", 等
    const correctRegex = /^(?:☑|✔|\[x\]|✓)?\s*Correct[\.\s:-]+/i;
    extraction = allLines.filter(l => correctRegex.test(l.trim())).map(l => l.replace(correctRegex, '').trim());
  }

  // 4. 智能抓取陷阱 (寻找 Incorrect 开头或带标签的行)
  let trap = extractLabeledContent(text, "Trap Point|Trap");
  trap = trap ? splitLines(trap) : [];
  if (trap.length === 0) {
    const incorrectRegex = /^(?:☐|❌|\[\s\]|✗)?\s*Incorrect[\.\s:-]+/i;
    trap = allLines.filter(l => incorrectRegex.test(l.trim())).map(l => l.replace(incorrectRegex, '').trim());
  }

  // 5. 抓取记忆钩子
  const hook = extractLabeledContent(text, "Memory Hook|Hook") || "";

  return { question, answer, extraction, trap, hook };
};

// ==========================================
// 🎨 主控面板组件
// ==========================================

export default function App() {
  const [inputText, setInputText] = useState("");
  const [cards, setCards] = useState([]);
  const [syncStatus, setSyncStatus] = useState("Connecting to Cloud ☁️...");
  const [isSaving, setIsSaving] = useState(false);

  // 实时预览分析结果
  const liveAnalysis = useMemo(() => buildLiveAnalysis(inputText), [inputText]);

  // 初次加载数据
  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch('/api/sync');
        if (res.ok) {
          const data = await res.json();
          const cloudCards = data.find(item => item.key === 'are_cards')?.value || [];
          setCards(cloudCards);
          setSyncStatus("Cloud Synced ✅");
        } else {
          throw new Error("API error");
        }
      } catch (e) {
        const local = localStorage.getItem('are_cards');
        if (local) setCards(JSON.parse(local));
        setSyncStatus("Offline Mode ⚠️");
      }
    };
    loadData();
  }, []);

  // 保存动作
  const handleSave = async () => {
    if (!liveAnalysis) return;
    setIsSaving(true);
    
    const newCard = { 
      id: Date.now(), 
      text: inputText, 
      analysis: liveAnalysis,
      savedAt: new Date().toISOString()
    };
    const updatedCards = [newCard, ...cards];
    
    setCards(updatedCards);
    localStorage.setItem('are_cards', JSON.stringify(updatedCards));

    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'are_cards', value: updatedCards })
      });
      setSyncStatus("Cloud Synced ✅");
      setInputText(""); // 清空输入框
    } catch (e) {
      setSyncStatus("Saved Locally (Cloud Error) ⚠️");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteCard = async (id) => {
    if (!window.confirm("Delete this flashcard permanently?")) return;
    const updated = cards.filter(c => c.id !== id);
    setCards(updated);
    localStorage.setItem('are_cards', JSON.stringify(updated));
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'are_cards', value: updated })
      });
    } catch(e) {
      console.error("Delete sync failed");
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '30px 20px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* 顶部导航 */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', paddingBottom: '15px', borderBottom: '2px solid #e2e8f0' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', color: '#2d3748', letterSpacing: '-0.5px' }}>ARE Error Book</h1>
            <p style={{ margin: '5px 0 0 0', color: '#718096', fontSize: '14px' }}>Smart OCR Parsing & Cloud Sync</p>
          </div>
          <div style={{ padding: '8px 16px', borderRadius: '999px', backgroundColor: syncStatus.includes('✅') ? '#def7ec' : '#feebc8', color: syncStatus.includes('✅') ? '#03543f' : '#7b341e', fontSize: '14px', fontWeight: '600' }}>
            {syncStatus}
          </div>
        </header>

        {/* 核心工作区：双栏布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
          
          {/* 左栏：输入区 */}
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📝 Step 1: Input & OCR Text
            </h2>
            <textarea
              style={{ width: '100%', height: '350px', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e0', backgroundColor: '#f8fafc', fontSize: '14px', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box', outline: 'none', transition: 'border 0.2s' }}
              placeholder="Paste your OCR text here.&#10;&#10;Auto-detection works for lines starting with 'Correct' or 'Incorrect'.&#10;&#10;Or use tags like:&#10;Question: ...&#10;Trap Point: ..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onFocus={(e) => e.target.style.borderColor = '#4299e1'}
              onBlur={(e) => e.target.style.borderColor = '#cbd5e0'}
            />
            <button 
              onClick={handleSave}
              disabled={!liveAnalysis || isSaving}
              style={{ width: '100%', marginTop: '16px', padding: '14px', backgroundColor: (!liveAnalysis || isSaving) ? '#a0aec0' : '#2b6cb0', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: (!liveAnalysis || isSaving) ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
            >
              {isSaving ? "Saving to Cloud..." : "Save to Cloud Database 🚀"}
            </button>
          </div>

          {/* 右栏：实时预览区 */}
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', border: '2px dashed #e2e8f0' }}>
            <h2 style={{ marginTop: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', color: '#4a5568' }}>
              👁️ Step 2: Live Preview
            </h2>
            
            {!liveAnalysis ? (
              <div style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0', fontStyle: 'italic' }}>
                Waiting for input...
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', maxHeight: '400px', paddingRight: '10px' }}>
                <div style={{ padding: '16px', backgroundColor: '#f7fafc', borderRadius: '8px', borderLeft: '4px solid #4a5568' }}>
                  <div style={{ fontSize: '12px', color: '#718096', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Question</div>
                  <div style={{ fontWeight: '500' }}>{liveAnalysis.question}</div>
                </div>

                {liveAnalysis.extraction.length > 0 && (
                  <div style={{ padding: '16px', backgroundColor: '#f0fff4', borderRadius: '8px', borderLeft: '4px solid #48bb78' }}>
                    <div style={{ fontSize: '12px', color: '#276749', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Correct Logic (Knowledge)</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#22543d' }}>
                      {liveAnalysis.extraction.map((item, i) => <li key={i} style={{ marginBottom: '4px' }}>{item}</li>)}
                    </ul>
                  </div>
                )}

                {liveAnalysis.trap.length > 0 && (
                  <div style={{ padding: '16px', backgroundColor: '#fff5f5', borderRadius: '8px', borderLeft: '4px solid #f56565' }}>
                    <div style={{ fontSize: '12px', color: '#c53030', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>Incorrect Logic (Trap Points)</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', color: '#742a2a' }}>
                      {liveAnalysis.trap.map((item, i) => <li key={i} style={{ marginBottom: '4px' }}>{item}</li>)}
                    </ul>
                  </div>
                )}
                
                {liveAnalysis.hook && (
                   <div style={{ padding: '16px', backgroundColor: '#fffff0', borderRadius: '8px', borderLeft: '4px solid #ecc94b' }}>
                    <div style={{ fontSize: '12px', color: '#b7791f', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '4px' }}>Memory Hook</div>
                    <div style={{ color: '#744210' }}>{liveAnalysis.hook}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 底部卡片画廊 */}
        <h2 style={{ fontSize: '22px', color: '#2d3748', marginBottom: '20px', paddingBottom: '10px', borderBottom: '2px solid #e2e8f0' }}>📚 Saved Flashcards ({cards.length})</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '24px' }}>
          {cards.map(card => (
            <div key={card.id} style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '6px solid #2b6cb0' }}>
              <button 
                onClick={() => deleteCard(card.id)} 
                style={{ position: 'absolute', top: '16px', right: '16px', border: 'none', background: '#edf2f7', color: '#a0aec0', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                onMouseEnter={(e) => { e.target.style.background = '#fed7d7'; e.target.style.color = '#e53e3e'; }}
                onMouseLeave={(e) => { e.target.style.background = '#edf2f7'; e.target.style.color = '#a0aec0'; }}
              >✕</button>
              
              <div style={{ paddingRight: '20px' }}>
                <div style={{ fontSize: '11px', color: '#a0aec0', marginBottom: '6px' }}>{new Date(card.savedAt).toLocaleString()}</div>
                <h4 style={{ margin: 0, color: '#2d3748', fontSize: '16px', lineHeight: '1.4' }}>{card.analysis.question}</h4>
              </div>

              {card.analysis.extraction.length > 0 && (
                <div style={{ backgroundColor: '#f0fff4', padding: '12px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#38a169', fontWeight: '700', marginBottom: '4px' }}>CORRECT LOGIC</div>
                  {card.analysis.extraction.map((item, i) => <div key={i} style={{ fontSize: '13px', color: '#22543d', marginBottom: '2px' }}>• {item}</div>)}
                </div>
              )}

              {card.analysis.trap.length > 0 && (
                <div style={{ backgroundColor: '#fff5f5', padding: '12px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#e53e3e', fontWeight: '700', marginBottom: '4px' }}>TRAP POINTS</div>
                  {card.analysis.trap.map((item, i) => <div key={i} style={{ fontSize: '13px', color: '#742a2a', marginBottom: '2px' }}>• {item}</div>)}
                </div>
              )}
            </div>
          ))}
          {cards.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: '#a0aec0', backgroundColor: '#fff', borderRadius: '16px', border: '2px dashed #e2e8f0' }}>
              No flashcards saved yet. Start typing above to create your first one!
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
