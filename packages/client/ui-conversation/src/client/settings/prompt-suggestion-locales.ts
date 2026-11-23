/** Copy beside the automatic next-message suggestion preference. */
export const PROMPT_SUGGESTION_SETTINGS_LOCALES = {
  en: {
    title: 'Suggest the next message',
    summary: 'Show a suggested follow-up in the composer after a reply.',
    toggle: 'Show suggestions',
    description: 'After a reply, send short excerpts of the exchange to the same model provider for a draft suggestion.',
    saveFailed: 'Could not save this preference. Try again.',
  },
  ja: {
    title: '次のメッセージを提案',
    summary: '回答後、入力欄に次のメッセージの候補を表示します。',
    toggle: '候補を表示',
    description: '回答後、直近のやり取りの短い抜粋を同じモデル提供元に送り、次のメッセージの候補を生成します。',
    saveFailed: '設定を保存できませんでした。もう一度お試しください。',
  },
  zh: {
    title: '建议下一条消息',
    summary: '回复结束后，在输入框中显示下一条消息的建议',
    toggle: '显示建议',
    description: '回复结束后，将刚才对话的简短摘录发送给同一模型提供方，生成下一条消息的草稿建议',
    saveFailed: '未能保存此设置，请重试',
  },
  de: {
    title: 'Nächste Nachricht vorschlagen',
    summary: 'Nach einer Antwort einen Vorschlag im Eingabefeld anzeigen.',
    toggle: 'Vorschläge anzeigen',
    description: 'Nach einer Antwort werden kurze Ausschnitte des Austauschs an denselben Modellanbieter gesendet, um einen Entwurf vorzuschlagen.',
    saveFailed: 'Die Einstellung konnte nicht gespeichert werden. Versuche es erneut.',
  },
  es: {
    title: 'Sugerir el siguiente mensaje',
    summary: 'Muestra una sugerencia en el campo de entrada después de una respuesta.',
    toggle: 'Mostrar sugerencias',
    description: 'Después de una respuesta, envía extractos breves del intercambio al mismo proveedor del modelo para sugerir un borrador.',
    saveFailed: 'No se pudo guardar esta preferencia. Inténtalo de nuevo.',
  },
  fr: {
    title: 'Suggérer le prochain message',
    summary: 'Affiche une suggestion dans le champ de saisie après une réponse.',
    toggle: 'Afficher les suggestions',
    description: 'Après une réponse, de courts extraits de l’échange sont envoyés au même fournisseur de modèle pour proposer un brouillon.',
    saveFailed: 'Impossible d’enregistrer cette préférence. Réessayez.',
  },
  pt: {
    title: 'Sugerir a próxima mensagem',
    summary: 'Mostra uma sugestão no campo de mensagens após uma resposta.',
    toggle: 'Mostrar sugestões',
    description: 'Depois de uma resposta, envia trechos curtos da conversa ao mesmo fornecedor do modelo para sugerir um rascunho.',
    saveFailed: 'Não foi possível salvar esta preferência. Tente novamente.',
  },
  ru: {
    title: 'Предлагать следующее сообщение',
    summary: 'Показывает предложение в поле ввода после ответа.',
    toggle: 'Показывать предложения',
    description: 'После ответа короткие отрывки разговора отправляются тому же поставщику модели для подготовки черновика.',
    saveFailed: 'Не удалось сохранить настройку. Попробуйте ещё раз.',
  },
} as const
