export type TranslationSchema = {
  common: {
    actions: {
      save: string;
      cancel: string;
      delete: string;
      edit: string;
      retry: string;
      confirm: string;
      close: string;
      loading: string;
      refresh: string;
      upload: string;
      download: string;
      export: string;
      import: string;
      search: string;
      reset: string;
      submit: string;
      back: string;
      next: string;
      create: string;
      update: string;
      remove: string;
      add: string;
      view: string;
      copy: string;
    };
    states: {
      loading: string;
      empty: string;
      failed: string;
      ready: string;
      processing: string;
      pending: string;
      completed: string;
      cancelled: string;
      none: string;
      all: string;
      active: string;
      inactive: string;
      enabled: string;
      disabled: string;
      online: string;
      offline: string;
    };
    messages: {
      savedSuccessfully: string;
      deletedSuccessfully: string;
      updatedSuccessfully: string;
      operationFailed: string;
      networkError: string;
      confirmDelete: string;
      unsavedChanges: string;
      copiedToClipboard: string;
    };
    time: {
      justNow: string;
      yesterday: string;
      daysAgo: string;
      hoursAgo: string;
      minutesAgo: string;
    };
  };
  layout: {
    sidebar: {
      workspace: string;
      authoring: string;
      settings: string;
      dashboard: string;
      documentInit: string;
      documentLibrary: string;
      knowledgeSearch: string;
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
  };
  language: {
    en: string;
    zhCN: string;
  };
  auth: {
    login: {
      title: string;
      adminSetup: string;
      welcomeBack: string;
      checkingWorkspace: string;
      username: string;
      password: string;
      confirmPassword: string;
      rememberMe: string;
      createAdmin: string;
      signIn: string;
      signingIn: string;
      creating: string;
      passwordMismatch: string;
      passwordTooShort: string;
      creationFailed: string;
      loginFailed: string;
      networkError: string;
      workspaceError: string;
      enterPassword: string;
      enterPasswordAgain: string;
      tagline: string;
      subtitle: string;
    };
    features: {
      smartDrafting: string;
      smartDraftingDesc: string;
      referenceManagement: string;
      referenceManagementDesc: string;
      modelManagement: string;
      modelManagementDesc: string;
    };
  };
  dashboard: {
    title: string;
    aiWorkspaceActive: string;
    welcomeBack: string;
    uploadNewDocument: string;
    draftsInProgress: string;
    workspaceOverview: string;
    stats: {
      documents: string;
      drafts: string;
      tokens: string;
      activeTasks: string;
    };
    quickActions: {
      uploadDocs: string;
      uploadDocsDesc: string;
      brainstorm: string;
      brainstormDesc: string;
      newDraft: string;
      newDraftDesc: string;
      browseLibrary: string;
      browseLibraryDesc: string;
    };
    empty: {
      noDocuments: string;
      noDocumentsDesc: string;
      noDrafts: string;
      noDraftsDesc: string;
    };
    recent: {
      recentDocuments: string;
      recentDrafts: string;
    };
  };
  documents: {
    title: string;
    upload: {
      title: string;
      dragAndDrop: string;
      or: string;
      uploadFiles: string;
      uploadFolder: string;
      supportedFormats: string;
      maxSize: string;
      queuing: string;
      queued: string;
      uploadFailed: string;
      fileEmpty: string;
      unsupportedFormat: string;
      noFileProvided: string;
    };
    processing: {
      title: string;
      startProcessing: string;
      processingSettings: string;
      autoSplit: string;
      splitStrategy: string;
      indexTarget: string;
      indexMode: string;
      indexTargetFull: string;
      indexTargetOriginal: string;
      indexModeBasic: string;
      indexModeGraph: string;
    };
  };
  library: {
    title: string;
    table: {
      name: string;
      format: string;
      status: string;
      size: string;
      chunks: string;
      uploaded: string;
      actions: string;
    };
    filters: {
      allFormats: string;
      allStatuses: string;
      search: string;
    };
    empty: string;
    deleteConfirm: string;
    batchDeleteConfirm: string;
    reindex: string;
    viewDocument: string;
  };
  search: {
    title: string;
    placeholder: string;
    results: string;
    noResults: string;
    noResultsDesc: string;
    tryKeyword: string;
    stages: {
      semantic: string;
      keyword: string;
    };
    modes: {
      local: string;
      global: string;
      hybrid: string;
    };
    filters: {
      allDocuments: string;
      minScore: string;
    };
  };
  writing: {
    title: string;
    editor: string;
    reference: string;
    outline: string;
    sections: {
      empty: string;
      emptyDesc: string;
      generate: string;
      generateAll: string;
      regenerate: string;
      editing: string;
      saving: string;
      saved: string;
      lock: string;
      unlock: string;
      locked: string;
      unlocked: string;
    };
    referencePanel: {
      title: string;
      noReferences: string;
      noReferencesDesc: string;
      groupBy: string;
      sortBy: string;
      insertIntoSection: string;
    };
    status: {
      pending: string;
      generating: string;
      reviewing: string;
      completed: string;
      failed: string;
    };
    compare: {
      title: string;
      generate: string;
      accept: string;
      reject: string;
    };
    humanize: {
      title: string;
      generate: string;
    };
    export: {
      title: string;
      markdown: string;
      pdf: string;
      docx: string;
      exportFailed: string;
    };
    assets: {
      diagrams: string;
      images: string;
      generating: string;
      pending: string;
      failed: string;
      confirm: string;
    };
    documentLanguage: {
      label: string;
      auto: string;
      english: string;
      chinese: string;
    };
  };
  brainstorm: {
    title: string;
    placeholder: string;
    startConversation: string;
    startConversationDesc: string;
    generateOutline: string;
    outlineGenerated: string;
    newSession: string;
    phases: {
      exploration: string;
      structuring: string;
      refinement: string;
    };
  };
  topology: {
    title: string;
    empty: string;
    emptyDesc: string;
    nodeTypes: {
      document: string;
      entity: string;
    };
  };
  models: {
    title: string;
    providers: {
      title: string;
      addProvider: string;
      editProvider: string;
      deleteProvider: string;
      deleteConfirm: string;
      name: string;
      type: string;
      apiBaseUrl: string;
      apiKey: string;
      testConnection: string;
      testing: string;
      testSuccess: string;
      testFailed: string;
      connected: string;
      disconnected: string;
    };
    models: {
      title: string;
      addModel: string;
      editModel: string;
      modelId: string;
      contextWindow: string;
      embeddingDim: string;
      embeddingBatchSize: string;
      capabilities: string;
      setDefault: string;
      removeDefault: string;
      isDefault: string;
      enabled: string;
      disabled: string;
    };
    capabilities: {
      chat: string;
      writing: string;
      embedding: string;
      rerank: string;
      image_generation: string;
    };
    usage: {
      title: string;
      last30Days: string;
      totalTokens: string;
      inputTokens: string;
      outputTokens: string;
      byModel: string;
      byModule: string;
    };
  };
  settings: {
    title: string;
    profile: {
      title: string;
      editProfile: string;
      username: string;
      displayName: string;
      email: string;
      bio: string;
      noEmail: string;
      avatar: string;
      changeAvatar: string;
      localAuth: string;
      passwordSettings: string;
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
      changePassword: string;
      updatePassword: string;
      passwordsMismatch: string;
      passwordUpdated: string;
      profileUpdated: string;
      updateFailed: string;
      avatarUpdated: string;
      avatarFailed: string;
      fileTooLarge: string;
      invalidFileType: string;
      passwordStrength: {
        weak: string;
        medium: string;
        strong: string;
      };
      emailCannotChange: string;
    };
    database: {
      title: string;
      type: string;
      sqlite: string;
      postgresql: string;
      host: string;
      port: string;
      database: string;
      user: string;
      password: string;
      save: string;
      testConnection: string;
      saved: string;
      saveFailed: string;
      migrationRequired: string;
    };
    storage: {
      title: string;
      provider: string;
      local: string;
      s3: string;
      accessKey: string;
      secretKey: string;
      bucket: string;
      region: string;
      endpoint: string;
      save: string;
      saved: string;
      saveFailed: string;
    };
    language: {
      title: string;
      interfaceLanguage: string;
      interfaceLanguageDesc: string;
    };
  };
  errors: {
    unauthorized: string;
    forbidden: string;
    notFound: string;
    serverError: string;
    networkError: string;
    sessionExpired: string;
    draftNotFound: string;
    sectionNotFound: string;
    documentNotFound: string;
    modelNotConfigured: string;
    ragNotConfigured: string;
    generationFailed: string;
    exportFailed: string;
    uploadFailed: string;
    noFileProvided: string;
    fileEmpty: string;
    unsupportedFormat: string;
    passwordIncorrect: string;
    unknown: string;
  };
};
