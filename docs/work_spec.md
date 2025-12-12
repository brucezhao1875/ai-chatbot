# AI Chat Application Work Specification (Work SRS)

## 1. Project Overview
This project is an AI-assisted Q&A system. Users submit a question, the backend retrieves relevant video transcripts from a knowledge base, re-ranks them, and provides the top relevant sources. The AI model then generates a summarized answer based on those sources.  
The UI presents two main views: **Answer** and **Sources**, allowing users to read the AI summary and inspect original transcripts.

---

## 2. Core Functional Requirements

### 2.1 User Question Input
- User enters a question via an input bar at the bottom of the interface.
- System submits the question to backend services.

### 2.2 Backend Retrieval Workflow
- Retrieve all related video subtitles based on embeddings / similarity search.
- Re-rank results using internal scoring logic.
- Select top N transcripts.
- Send selected transcripts to an LLM to produce a summarized answer.
- Return both:
  - AI Summary (answer)
  - List of sources (videos + transcripts)

---

## 3. UI Architecture (Two Main Tabs)

The application UI is divided into two top-level pages:

### **TAB 1: Answer Page**
- Displays the AI-generated summary.
- Text should appear in paragraph-based document format (not chat bubbles).
- Content area must support long-form text.
- Reading experience must be fluid and structured.

### **TAB 2: Sources Page**
- Displays all source materials used in generating the answer.
- Each source contains:
  - Video Title  
  - YouTube Link (opens in a new window)  
  - Transcript (default collapsed; expandable)

#### Transcript Handling
- Transcripts can be very long (thousands of lines).
- Must be collapsible to avoid overwhelming the UI.
- When expanded, show full transcript in readable mono/paragraph text.

---

## 4. Layout Specification

### 4.1 Max-Width Container (Perplexity-like)
- All content (Answer and Sources) must stay inside a fixed-width layout:
  - **max-width: 760–840px (recommended: 780px)**
- Container must be centered horizontally.
- Tabs and content share the same width container.
- Switching tabs must not cause page shifting.

### 4.2 Header
- Displays application title (e.g., "AI Chat").
- Stays centered with the same content width.

### 4.3 Tabs
- Two tabs:
  - **Answer**
  - **Sources**
- Clicking a tab shows the corresponding content section.
- Tabs must remain visually consistent and centered.

### 4.4 Input Bar
- Stays at the bottom.
- Always visible.
- Allows user to enter new questions.
- Should span full width, but input field content stays aligned with the 780px container.

---

## 5. Interaction Design

### 5.1 Ask → Retrieve → Answer Flow
1. User submits a question.
2. System fetches relevant video transcripts.
3. Backend ranks and selects top sources.
4. LLM generates summary.
5. UI displays:
   - Answer in **Answer Tab**
   - Sources in **Sources Tab**

### 5.2 Transcript Expansion
- Sources page lists each video as:
  ```
  Video Title
  [Open Video on YouTube]
  [Expand Transcript]
  ```
- Clicking **Expand** shows:
  - timestamped lines  
  - raw transcript text  

### 5.3 Video Link Behavior
- Clicking a YouTube link opens in a **new browser window**.
- No embedded players in the current UI version.

---

## 6. Component Architecture

### 6.1 `ChatLayout`
- Controls page width, centering, vertical stacking.
- Contains Header, Tabs, TabContent, InputBar.

### 6.2 `Tabs`
- Renders Answer / Sources tab controls.
- State-managed: activeTab = "answer" | "sources".

### 6.3 `AnswerView`
- Displays AI-generated summary.
- Text rendered in structured paragraphs.

### 6.4 `SourcesView`
- Displays list of source items.

### 6.5 `SourceItem`
Contains:
- `VideoTitle`
- `ExternalLinkButton` (YouTube)
- `TranscriptToggle`
- `TranscriptView` (collapsed by default)

### 6.6 `TranscriptView`
- Long text renderer.
- Scrollable or block-based.
- Supports line breaks and timestamps.

### 6.7 `InputBar`
- Text input for user questions.
- Submit button or Enter-key trigger.

---

## 7. Error Handling

### Retrieval Failures
- Display fallback message: "Unable to retrieve sources."

### LLM Failure
- Display neutral error message.

### Transcript Missing
- Show: "Transcript not available."

---

## 8. Performance Considerations

### Large Transcript Handling
- Use lazy rendering for large text.
- Always default to collapsed state.

### Memory Efficiency
- Avoid loading all transcripts into DOM until expanded.

---

## 9. Future Enhancements (Optional)
- Modal video player (inline preview)
- Highlighting transcript passages referenced by AI
- Multi-language subtitle support
- Source scoring display

---

## 10. Summary
This specification defines the UX, structure, logic, and behavior for an AI chat application that presents both AI summaries and verifiable source transcripts.  
The interface must be simple, structured, and optimized for long-form reading, following a Perplexity-style dual-tab model.

