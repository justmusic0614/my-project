# 11

## Source

- Document-ID: 11
- Source-Type: local-file
- Source-Basename: 11.mp4
- File: /Users/suweicheng/Desktop/課程學習/Udemy/Udemy/11.mp4
- Generated: 2026-03-20T11:55:00+08:00
- Engine: kd-local
- Model: openai/gpt-4o-mini
- Style: brain
- Template-Version: brain_v1
- Duration: 3:16
- Transcript-Language: Chinese

---

## Executive Insight
這段內容強調了使用 AI 助手 Claude 的多種功能，包括清除會話、管理上下文窗口以及同時運行多個會話的能力。這些功能使開發者能夠更有效地控制 AI 的行為，並在不同的問題上進行平行處理。

## Core Concepts
1. **Slash Commands**
   - **定義**：以斜線開頭的命令，用於執行特定操作。
   - **為什麼重要**：提供快速的操作方式，提升使用效率。
   - **典型使用情境**：用戶輸入斜線命令以快速清除會話或檢查上下文使用情況。

2. **Clear Command**
   - **定義**：一種特定的斜線命令，用於清除當前會話的上下文。
   - **為什麼重要**：幫助用戶重置會話，釋放上下文記憶，避免混淆。
   - **典型使用情境**：當 AI 無法解決問題或用戶需要處理不同問題時。

3. **Context Window**
   - **定義**：AI 在當前會話中可用的上下文記憶空間。
   - **為什麼重要**：影響 AI 的回應質量和準確性。
   - **典型使用情境**：用戶查看上下文窗口的使用情況，以確保有足夠的空間進行新任務。

4. **Parallel Sessions**
   - **定義**：同時運行多個 Claude 會話的能力。
   - **為什麼重要**：允許用戶在不同的問題上同時工作，提高生產力。
   - **典型使用情境**：開發者在同一專案中使用多個會話，避免相互干擾。

## Knowledge Graph
```
- AI 助手 Claude
  - Slash Commands
    - Clear Command
    - Context Window
  - Parallel Sessions
```

## Knowledge Graph Triples
- (AI 助手 Claude) —[包含]→ (Slash Commands)
- (Slash Commands) —[包含]→ (Clear Command)
- (Slash Commands) —[包含]→ (Context Window)
- (AI 助手 Claude) —[支持]→ (Parallel Sessions)

## Technical Elements
| 技術/工具       | 說明                           |
|----------------|--------------------------------|
| Slash Commands  | 快速執行特定操作的命令        |
| Clear Command   | 清除當前會話上下文的命令      |
| Context Window  | 當前會話的上下文記憶空間      |
| Parallel Sessions| 同時運行多個會話的能力       |

## Workflow Extraction
- **Input**: 用戶輸入斜線命令
- **Process**: 系統解析命令並執行相應操作
- **Output**: 更新會話狀態或顯示上下文使用情況

## Mental Models
- 使用斜線命令作為操作的快捷方式，提升效率。
- 清除會話作為重置工具，確保上下文的清晰性。
- 平行會話作為多任務處理的策略，提升工作流的靈活性。

## Engineering Insights
- 解決的問題：如何有效管理 AI 的上下文和會話。
- 與其他方法的差異：提供即時的命令執行和上下文管理。
- 優勢：提升開發者的控制力和效率。
- 限制：需要開發者主動管理會話，避免混淆。

## System Architecture
```
Data Sources → Processing (AI 助手 Claude) → Storage (上下文記憶) → Application (用戶界面) → Agents (多個會話)
```

## Automation Opportunities
- **Agent**: 自動清除會話的功能
- **Cronjob**: 定期檢查上下文使用情況
- **API Integration**: 與其他工具的集成以增強功能

## AI Agent Design
- **Name**: Session Manager
- **Purpose**: 管理和清除 AI 會話
- **Input**: 用戶命令
- **Processing**: 執行清除或檢查上下文
- **Output**: 更新會話狀態或顯示上下文信息

## Research Roadmap
- **短期**: 深入研究斜線命令的擴展性
- **中期**: 開發自動化上下文管理工具
- **長期**: 探索多會話協作的最佳實踐

## Practical Applications
- 商業：用於多任務處理的 AI 助手
- 技術：提升開發者工作效率的工具
- AI：增強上下文管理的智能系統

## Key Takeaways
1. 斜線命令提供快速操作的便利性。
2. 清除會話有助於釋放上下文記憶。
3. 平行會話支持多任務處理。
4. 上下文窗口的管理對 AI 回應質量至關重要。
5. 開發者需主動管理會話以避免干擾。

## Knowledge Integration
將這些概念整合到 AI 系統中，可以通過設計一個智能的會話管理代理，來自動化上下文的清理和管理，並提高用戶的操作效率。

---

## Transcript

With that, we have the base usage left, and obviously you can open it, you can type a prompt, I know, but there's a bit more to that. For one, it's worth noting that there are many slash commands which you can start by simply typing slash and then some command. Then these change over time; new ones are added, some are deprecated. One important one, for example, is the clear command, which I just ran, which can run again. The clear command simply clears the current session and important the context window related to the session, so that you can start a new clean session. Of course, that session and the AI running in there won't know anything about the previous one. But you typically want that when you clear a session, you want to free up the context memory and start fresh. This can, for example, also be helpful if the AI agent gets stuck and can't figure out or fix a problem, or if you're simply working on a different problem. Obviously, you can also just start a new session by opening a new terminal window and starting Claude in there too. You can have multiple Claude code sessions run in parallel. You can work on the same project with multiple Claude code sessions. You just want to steer it such that the agents don't work against each other in the same file, for example. But hey, that's why you're a developer; you can control what you're doing with the AI assistant. Now there are many other useful tools in there too. For example, context tells you how the context window for this session is currently being used or occupied. And since I just cleared it, it's almost empty. Well, kind of interestingly enough, 20,000 of the 200,000 tokens that are available for Claude code, open the model I'm using here when recording this, are already occupied by default. And you see that a part of that is the system prompt that was set up by the Claude code engineers and and fabric. A decent chunk is occupied by system tools, so tool descriptions that are exposed to Claude code to give it some hints on when to use which tool, and we'll get back to that. Some small part is occupied by MCP tools because I already added some MCP servers, but I'll also get back to that. And well, you see the distribution, but you also see there's a lot of free space. Also interesting is the auto compact buffer, and we'll get
