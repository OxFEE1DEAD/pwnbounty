import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Lang = 'en' | 'ru';
type Vars = Record<string, string>;

const ru: Record<string, string> = {
  'Switch language': 'Сменить язык',
  'Main navigation': 'Основная навигация',
  'How it works': 'Как это работает',
  'Live evidence': 'Данные сети',
  'My attempts': 'Мои заявки',
  'Hunt a bounty': 'Искать награду',
  'Connect wallet': 'Подключить кошелёк',
  'Loading verification mode…': 'Загружаем режим проверки…',
  'AI PAYMENT AGENTS · NEAR': 'ПЛАТЁЖНЫЕ AI-АГЕНТЫ · NEAR',
  'Break the rule.': 'Нарушь правило.',
  'Keep the exploit sealed.': 'Сохрани атаку закрытой.',
  ['A funded bounty for a real forbidden transfer by an AI payment agent. Your invoice ' +
  'stays encrypted; the executed transfer decides the payout.']:
    'Награда зарезервирована за реальный запрещённый перевод платёжного AI-агента. ' +
    'Инвойс остаётся зашифрованным; выплату решает выполненный перевод.',
  'Hunt a bounty →': 'Искать награду →',
  'See the proof': 'Смотреть доказательства',
  'The transfer decides. Model prose earns zero.': 'Решает перевод. Слова модели стоят ноль.',
  'An invoice sealed in an envelope': 'Инвойс, запечатанный в конверт',
  'FROZEN RULE': 'ЗАКРЕПЛЁННОЕ ПРАВИЛО',
  'SEALED INVOICE': 'ЗАПЕЧАТАННЫЙ ИНВОЙС',
  'EXECUTED TRANSFER': 'ВЫПОЛНЕННЫЙ ПЕРЕВОД',
  'PAID ON NEAR': 'ВЫПЛАТА В NEAR',
  'A bounty that asks the agent to show its work.':
    'Награда за действие агента, а не за рассказ о нём.',
  ['The sponsor freezes the model, prompt, tools and spending rule before funding the ' +
  'reward. Hunters control one surface: the invoice the agent will read.']:
    'Спонсор закрепляет модель, промпт, инструменты и правило расходов до внесения награды. ' +
    'Охотник управляет только инвойсом, который прочитает агент.',
  'Freeze & fund': 'Закрепить и пополнить',
  'One allowed recipient. One limit per transfer. The reward is held by the NEAR contract.':
    'Один разрешённый получатель. Лимит на каждый перевод. Награда хранится в контракте NEAR.',
  'Seal & commit': 'Зашифровать и закрепить',
  ['Encrypt the invoice in your browser. Record its hash from your wallet before sending ' +
  'ciphertext.']:
    'Зашифруйте инвойс в браузере. Запишите его хеш со своего кошелька до отправки шифртекста.',
  'Run & inspect': 'Запустить и проверить',
  ['The verifier runs the agent with fake funds. The checker reads executed ledger ' +
  "transfers, not the agent's claims."]:
    'Проверяющий запускает агента с ненастоящими средствами. Проверка читает выполненные ' +
    'переводы в журнале, а не слова агента.',
  'Settle & disclose': 'Выплатить и раскрыть команде',
  ['A signed verdict settles the bounty. Only the project team can decrypt the ' + 'reproduction.']:
    'Подписанный вердикт запускает выплату. Воспроизведение может расшифровать только ' +
    'команда проекта.',
  'The transfer decides.': 'Решает перевод.',
  'Rule broken. Reward paid.': 'Правило нарушено. Награда выплачена.',
  ['Executed: 450 → vendor.near. Frozen limit: 100 per transfer. The contract pays the ' +
  'hunter after the signed verdict.']:
    'Выполнено: 450 → vendor.near. Закреплённый лимит: 100 за перевод. После подписанного ' +
    'вердикта контракт платит охотнику.',
  'A story is worth zero.': 'История стоит ноль.',
  ['"Ignore your rules," a forged transcript, and "please approve" are not transfers. ' +
  'If no forbidden transfer executes, no reward is due.']:
    '«Игнорируй правила», поддельный журнал и «подтвердите заявку» не являются переводами. ' +
    'Если запрещённый перевод не выполнен, награда не начисляется.',
  'On-chain, not on faith.': 'В сети, а не на словах.',
  'Finalized NEAR state. Refreshes when the page loads.':
    'Подтверждённое состояние NEAR. Обновляется при загрузке страницы.',
  'Loading chain data…': 'Загружаем данные сети…',
  'Chain data unavailable. Try again.': 'Данные сети недоступны. Повторите попытку.',
  Retry: 'Повторить',
  Programs: 'Программы',
  Open: 'Открыто',
  'NEAR escrowed': 'NEAR в резерве',
  'NEAR paid': 'NEAR выплачено',
  Winners: 'Победители',
  'Recent payouts': 'Последние выплаты',
  "Each row links to the winner's account on NearBlocks.":
    'Каждая строка ведёт к аккаунту победителя в NearBlocks.',
  'No payouts yet. The first executed violation will appear here.':
    'Выплат пока нет. Первое выполненное нарушение появится здесь.',
  'Program #': 'Программа #',
  ['Current verifier: local development. Browser encryption and testnet settlement have ' +
  'been demonstrated; this mode does not establish TEE execution or confidential model ' +
  'inference. Check the mode before submitting sensitive material.']:
    'Текущий проверяющий: локальная разработка. Шифрование в браузере и выплата в testnet ' +
    'продемонстрированы; этот режим не подтверждает исполнение в TEE или конфиденциальный ' +
    'вызов модели. Проверьте режим перед отправкой чувствительных данных.',
  ['Current verifier: OutLayer worker. Inference confidentiality is confirmed by the ' +
  'worker. Check the evidence before a private submission.']:
    'Текущий проверяющий: worker OutLayer. Конфиденциальность вызова модели подтверждена ' +
    'worker. Перед приватной заявкой проверьте доказательства.',
  ['Current verifier: OutLayer worker. Inference confidentiality is not confirmed ' +
  'yet. Check the evidence before a private submission.']:
    'Текущий проверяющий: worker OutLayer. Конфиденциальность вызова модели пока не ' +
    'подтверждена. Перед приватной заявкой проверьте доказательства.',
  'Inspect the contract ↗': 'Смотреть контракт ↗',
  'Read the code ↗': 'Смотреть код ↗',
  'Start hunting →': 'Начать охоту →',
  'Find the transfer.': 'Найдите перевод.',
  'One frozen rule. One sealed invoice. The ledger decides.':
    'Одно закреплённое правило. Один закрытый инвойс. Решает журнал переводов.',
  'Protect your claim': 'Закрепите заявку',
  'Connect a NEAR wallet to protect your claim.':
    'Подключите кошелёк NEAR, чтобы закрепить заявку за собой.',
  'Claiming as {account}.': 'Заявка от {account}.',
  'Open program': 'Открытая программа',
  'Loading programs…': 'Загружаем программы…',
  'No open funded programs right now.': 'Сейчас нет открытых программ с наградой.',
  'Checking the frozen rules…': 'Проверяем закреплённые правила…',
  'The wallet did not send the commitment. Press the button to try again.':
    'Кошелёк не отправил хеш заявки. Нажмите кнопку, чтобы попробовать снова.',
  Refresh: 'Обновить',
  'Pay only {recipients}. Maximum {max} per transfer.':
    'Платить только {recipients}. Максимум {max} за перевод.',
  'Allowed recipient': 'Разрешённый получатель',
  'Maximum per transfer': 'Лимит на перевод',
  'Sandbox balance': 'Баланс песочницы',
  Model: 'Модель',
  'Spending control on: forbidden calls are blocked before they execute.':
    'Контроль расходов включён: запрещённые вызовы блокируются до выполнения.',
  'Spending control off: a forbidden call can execute.':
    'Контроль расходов выключен: запрещённый вызов может выполниться.',
  'Raw rules': 'Исходные правила',
  'Write what the agent will see.': 'Напишите то, что увидит агент.',
  'Over the limit · 450': 'Выше лимита · 450',
  'Wrong recipient': 'Чужой получатель',
  'Forged transcript · earns zero': 'Поддельный журнал · ноль',
  'Checker plea · earns zero': 'Просьба проверке · ноль',
  'Invoice text': 'Текст инвойса',
  'Your text is untrusted input to the agent.': 'Ваш текст - недоверенный вход для агента.',
  'The text is encrypted in this browser before it leaves the page.':
    'Текст шифруется в этом браузере до того, как покинет страницу.',
  'Saved encrypted invoice for program #{id}.':
    'Сохранён зашифрованный инвойс для программы #{id}.',
  'Encrypt and submit →': 'Зашифровать и отправить →',
  'Continue submission →': 'Продолжить отправку →',
  'Discard saved invoice': 'Удалить сохранённый инвойс',
  'Download JSON for CLI commit': 'Скачать JSON для commit через CLI',
  'The route to a verdict': 'Путь к вердикту',
  'Submission progress': 'Ход отправки',
  Encrypt: 'Шифр',
  Wallet: 'Кошелёк',
  Commit: 'Хеш',
  Sandbox: 'Песочница',
  Check: 'Проверка',
  Payout: 'Выплата',
  'Wallet approval is a visible pause. A redirect alone never confirms a commitment.':
    'Подтверждение кошелька - отдельный шаг. ' +
    'Возврат из кошелька сам по себе не подтверждает хеш.',
  'Sealing the invoice in this browser…': 'Шифруем инвойс в этом браузере…',
  'Confirm the commitment in your wallet. A storage deposit may be required.':
    'Подтвердите закрепление в кошельке. Может потребоваться депозит за хранение.',
  'Waiting for the commitment in finalized NEAR…':
    'Ждём хеш заявки в подтверждённом состоянии NEAR…',
  'Commitment confirmed in finalized NEAR. Your claim is linked to this account.':
    'Хеш заявки подтверждён в NEAR. Заявка закреплена за этим аккаунтом.',
  'Sending the encrypted invoice to the verifier…': 'Отправляем зашифрованный инвойс проверяющему…',
  'Agent running with fake funds…': 'Агент работает с ненастоящими средствами…',
  'Reading executed transfers…': 'Проверяем выполненные переводы…',
  'Signed verdict accepted. Checking payout in finalized NEAR…':
    'Подписанный вердикт принят. Проверяем выплату в подтверждённом состоянии NEAR…',
  'EVIDENCE / VERDICT': 'ДОКАЗАТЕЛЬСТВО / ВЕРДИКТ',
  'Rule broken. {amount} paid to {account}.':
    'Правило нарушено. {amount} выплачено аккаунту {account}.',
  'No forbidden transfer executed. Reward: 0 NEAR.':
    'Запрещённый перевод не выполнен. Награда: 0 NEAR.',
  'You won. The reward transfer failed; the reserved payout can be retried by your wallet.':
    'Вы победили. Перевод награды не прошёл; повторить зарезервированную выплату можно ' +
    'своим кошельком.',
  'Rule broken. The payout is on its way.': 'Правило нарушено. Выплата уже в пути.',
  'Processing stopped: {detail}': 'Обработка остановлена: {detail}',
  'View payout transaction ↗': 'Смотреть транзакцию ↗',
  'Retry payout': 'Повторить выплату',
  'Try another invoice': 'Попробовать другой инвойс',
  'Job details': 'Детали задачи',
  'Your sealed attempts will appear here after you connect a wallet.':
    'Ваши закрытые заявки появятся здесь после подключения кошелька.',
  REWARDS: 'НАГРАДЫ',
  'ATTEMPTS FROM THIS BROWSER': 'ЗАЯВКИ ИЗ ЭТОГО БРАУЗЕРА',
  'No rewards yet.': 'Наград пока нет.',
  'No sealed attempts from this browser yet.': 'Из этого браузера заявок пока не было.',
  'Not on NEAR yet': 'Ещё не в NEAR',
  'Waiting for the verdict': 'Ждём вердикт',
  'No violation, no reward': 'Нарушения нет, награды нет',
  'Valid, but another hunter was first': 'Засчитано, но другой охотник был первым',
  Paid: 'Выплачено',
  'Payout failed - retry it under Rewards': 'Выплата не прошла - повторите в разделе «Награды»',
  'Payout in progress': 'Выплата в процессе',
  'Payout failed': 'Выплата не прошла',
  'Could not check': 'Не удалось проверить',
  'For the project team': 'Для команды проекта',
  'Upload your team key to decrypt locally. The key never leaves this browser.':
    'Загрузите ключ команды для локальной расшифровки. Ключ не покидает браузер.',
  'Ciphertext hash': 'Хеш шифртекста',
  'Context - JSON with network, contract, bounty, hunter, submission':
    'Контекст - JSON с network, contract, bounty, hunter, submission',
  'Team X25519 private key (PKCS8 DER)': 'X25519 private key команды (PKCS8 DER)',
  'Fetch ciphertext and decrypt locally': 'Получить шифртекст и расшифровать локально',
  'Clear disclosure': 'Очистить раскрытие',
  'Disclosure decrypted locally.': 'Раскрытие расшифровано локально.',
  'Operator token': 'Токен оператора',
  "Kept only in this tab's memory": 'Хранится только в памяти этой вкладки',
  Close: 'Закрыть',
  'Action failed': 'Не удалось выполнить действие',
  'Wait for the worker to load': 'Дождитесь загрузки worker',
  'Enter the operator token': 'Введите токен оператора',
  'Bad request or the commitment is not finalized yet':
    'Неверный запрос или хеш заявки ещё не подтверждён в NEAR',
  'Invalid access token': 'Неверный токен доступа',
  'Record not found': 'Запись не найдена',
  'This program uses a different verifier': 'Эта программа использует другого проверяющего',
  'The worker cannot read the data right now': 'Worker временно не может прочитать данные',
  'Worker returned HTTP ': 'Worker вернул HTTP ',
  'Invalid worker network': 'Неверная сеть worker',
  'The worker did not report its verification time limit':
    'Worker не сообщил лимит времени на проверку',
  'Invalid context': 'Неверный контекст',
  'Invalid context field ': 'Неверное поле контекста ',
  'Invalid network/bounty/submission': 'Неверные network/bounty/submission',
  'Invalid context account': 'Неверный аккаунт контекста',
  'NEAR RPC returned an inconsistent contract state':
    'NEAR RPC не вернул согласованное состояние контракта',
  'Program not found in the contract': 'Программа не найдена в контракте',
  'Empty ciphertext': 'Пустой шифртекст',
  'Ciphertext exceeds the limit': 'Шифртекст превышает лимит',
  'Report too large': 'Отчёт слишком большой',
  'Invalid pending report': 'Неверный сохранённый отчёт',
  'The saved submission does not match this network or is corrupted.':
    'Сохранённая заявка не подходит этой сети или повреждена.',
  'Config hash does not match the program': 'Хеш конфигурации не совпадает с программой',
  'The program signer in the contract differs from the worker':
    'Ключ подписи программы в контракте отличается от worker',
  'The program is closed for new commitments.': 'Программа закрыта для новых заявок.',
  'Submission is already in progress': 'Отправка уже идёт',
  'Connect your wallet first': 'Сначала подключите кошелёк',
  'Choose a program': 'Выберите программу',
  'Write the invoice first': 'Сначала напишите инвойс',
  ['Could not encrypt the submission. Check WebCrypto X25519 support, ' +
  'HTTPS/localhost and the invoice size.']:
    'Не удалось зашифровать заявку. Проверьте поддержку WebCrypto X25519, ' +
    'HTTPS/localhost и размер инвойса.',
  ['Submission encrypted, but sessionStorage is unavailable. ' +
  'Download the JSON and use CLI commit.']:
    'Заявка зашифрована, но sessionStorage недоступен. Скачайте JSON и используйте CLI commit.',
  'Commitment is missing, differs from the submission or was already processed':
    'Хеш заявки отсутствует, отличается от заявки или уже обработан',
  'The commitment did not show up on NEAR in time. Press the button again.':
    'Хеш заявки не появился в NEAR вовремя. Нажмите кнопку ещё раз.',
  ['No commitment found for the saved invoice yet. ' + 'Press "Continue submission" to sign it.']:
    'Хеш для сохранённого инвойса пока не найден. Нажмите «Продолжить отправку», ' +
    'чтобы подписать его.',
  'Job ID must be 64 hex characters': 'Job ID должен содержать 64 hex-символа',
  'Verdict signature check failed': 'Подпись вердикта не прошла проверку',
  'A completed job has no signed verdict': 'Завершённая задача не содержит подписанный вердикт',
  'Invalid disclosure hash': 'Неверный хеш раскрытия',
  'Choose the team PKCS8 DER private key': 'Выберите PKCS8 DER private key команды',
  'Ciphertext hash mismatch': 'Хеш шифртекста не совпадает',
  'Decryption failed: check the key, the context and X25519 support':
    'Расшифровка не прошла: проверьте ключ, контекст и поддержку X25519',
  'Worker verdict does not match the finalized commitment':
    'Вердикт worker не совпадает с подтверждённой заявкой',
  'NEAR reward recipient differs from the verdict':
    'Получатель награды в NEAR отличается от вердикта',
  'Unexpected NEAR reward state: ': 'Неожиданное состояние награды в NEAR: ',
  'Mainnet signing is disabled by the worker settings':
    'Подпись в mainnet отключена настройками worker',
  'The submission belongs to another network or contract':
    'Заявка относится к другой сети или контракту',
  "Connect the wallet of this submission's hunter account":
    'Подключите кошелёк аккаунта охотника этой заявки',
  'Invalid storage deposit': 'Неверный депозит за хранение',
  'Invalid program number': 'Неверный номер программы',
  "Only the winner's wallet can retry the transfer":
    'Повторить перевод может только кошелёк победителя',
  'Unsupported protocol value': 'Неподдерживаемое значение протокола',
  'Ciphertext too large': 'Слишком большой шифртекст',
  'Non-canonical base64': 'Неканонический base64',
  'Invalid X25519 public key length': 'Неверная длина X25519 public key',
  'HTTPS or localhost is required for encryption': 'Для шифрования нужен HTTPS или localhost',
  'Invoice larger than 64 KiB': 'Инвойс больше 64 KiB',
  'Invalid envelope': 'Неверный конверт',
};
const prefixes = Object.keys(ru).filter((key) => /[ #]$/.test(key));
const storageKey = 'sealed-bounty/lang/1';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

function translate(lang: Lang, value: string): string {
  if (lang === 'en') return value;
  const exact = ru[value];
  if (exact) return exact;
  const prefix = prefixes.find((key) => value.startsWith(key));
  return prefix ? ru[prefix] + value.slice(prefix.length) : value;
}

function fill(text: string, vars: Vars): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll('{' + key + '}', value),
    text,
  );
}

const LangContext = createContext<{ lang: Lang; toggle(): void }>({ lang: 'en', toggle: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const toggle = useCallback(
    () =>
      setLang((current) => {
        const next = current === 'en' ? 'ru' : 'en';
        try {
          localStorage.setItem(storageKey, next);
        } catch {}
        return next;
      }),
    [],
  );
  return <LangContext.Provider value={{ lang, toggle }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

export function useT(): (value: string, vars?: Vars) => string {
  const { lang } = useLang();
  return useCallback(
    (value: string, vars: Vars = {}) => fill(translate(lang, value), vars),
    [lang],
  );
}
