export type TranslationKeys = {
  sidebar: {
    workspace: string;
    authoring: string;
    settings: string;
    dashboard: string;
    documentInit: string;
    documentLibrary: string;
    mindOrganization: string;
    documentWriting: string;
    documentTopology: string;
    modelManagement: string;
    userManagement: string;
  };
  userMenu: {
    userSettings: string;
    darkMode: string;
    lightMode: string;
    language: string;
    logout: string;
    about: string;
  };
  about: {
    title: string;
    subtitle: string;
    version: string;
    techStack: string;
    copyright: string;
  };
  language: {
    zhCN: string;
    en: string;
  };
};

const zhCN: TranslationKeys = {
  sidebar: {
    workspace: "工作区",
    authoring: "创作",
    settings: "设置",
    dashboard: "仪表盘",
    documentInit: "文档初始化",
    documentLibrary: "文档库",
    mindOrganization: "思维整理",
    documentWriting: "文档撰写",
    documentTopology: "文档拓扑",
    modelManagement: "模型管理",
    userManagement: "用户管理",
  },
  userMenu: {
    userSettings: "用户设置",
    darkMode: "深色模式",
    lightMode: "浅色模式",
    language: "语言支持",
    logout: "退出登录",
    about: "关于应用",
  },
  about: {
    title: "关于 Synthetix",
    subtitle: "AI 驱动的文档创作平台",
    version: "版本",
    techStack: "基于 Next.js、TypeScript、Prisma 和 SQLite 构建",
    copyright: "保留所有权利",
  },
  language: {
    zhCN: "简体中文",
    en: "English",
  },
};

export default zhCN;
