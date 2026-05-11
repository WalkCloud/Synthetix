# Synthetix Design System V2.1 (Modern AI Workspace)

## 1. 设计理念与产品定位
**核心定位**：企业级 AI 智能文档平台
**设计理念**：现代、轻盈、通透。摒弃传统企业软件的沉重感（Warm Professional 的暖色系与重阴影），转向以内容为中心、以 AI 辅助为亮点的现代工作空间 (Modern AI Workspace)。

## 2. 颜色规范 (Color System)
*   **Background (背景色)**：`#F8FAFC` (Slate 50)。提供纯净、现代的画布，减少视觉疲劳。
*   **Foreground (文本色)**：`#0F172A` (Slate 900)。高对比度，保证清晰可读。
*   **Primary (品牌强调色)**：`#7C3AED` (Violet 600)。代表“AI 与智能”，在极简的背景中脱颖而出。
*   **Muted/Secondary (次级元素)**：`#64748B` (Slate 500) 和 `#F1F5F9` (Slate 100)。用于次要文本、边框和卡片悬停背景。

## 3. 空间与投影 (Spacing & Shadows)
*   **圆角体系 (Border Radius)**：
    *   外部大容器/主卡片：`16px` (`rounded-2xl`)
    *   内部交互元素/小卡片：`12px` (`rounded-xl`)
    *   按钮/徽标：`8px` (`rounded-lg`) 或全圆角 (`rounded-full`)
*   **投影体系 (Shadows)**：
    *   基础轻阴影 (`shadow-soft`)：`0 4px 24px -4px rgba(0, 0, 0, 0.03)`，营造界面“干净、通透”的空间感。
    *   悬停阴影 (`shadow-hover`)：`0 12px 32px -8px rgba(0, 0, 0, 0.08)`，赋予元素灵动性。

## 4. 关键组件视觉规范
*   **Welcome Hero (欢迎模块)**：使用纯白底色配合极浅的 Mesh Gradient（网格渐变）或光晕，内部的统计卡片使用玻璃拟态（Glassmorphism，半透明背景 + 背景模糊）。
*   **Quick Actions (快捷操作)**：默认白色卡片，Hover 时边框根据对应功能的语义色点亮（如：主色、蓝色、绿色、橙色），并伴有平滑的 `-translate-y-1` 位移。
*   **状态指示 (Status Indicators)**：使用鲜明的主题色搭配 `animate-pulse`（呼吸动画），形成发光点（Status Dot）的效果，增强 AI 动态工作的生命力感。
