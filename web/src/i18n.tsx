import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Lang = 'en' | 'ru';
type Vars = Record<string, string>;

const ru: Record<string, string> = {
  'Switch language': 'Сменить язык',
  'Main navigation': 'Основная навигация',
  'How it works': 'Как это работает',
  Coverage: 'Покрытие',
  'For projects': 'Для проектов',
  'My attempts': 'Мои заявки',
  'Hunt a bounty': 'Искать награду',
  'Connect wallet': 'Подключить кошелёк',
  'Loading verification mode…': 'Загружаем режим проверки…',
  'SEALED BUG BOUNTIES · NEAR': 'ЗАКРЫТЫЕ БАГ-БАУНТИ · NEAR',
  'A bug bounty that pays': 'Баг-баунти с выплатой',
  'for a proved break.': 'за доказанный взлом.',
  'Projects freeze their code and fund a reward. Hunters send an encrypted attack. A fresh copy of the chain replays it, and the contract pays only if value really moved.':
    'Проект закрепляет код и вносит награду. Охотник отправляет зашифрованную атаку. Свежая копия сети воспроизводит её, и контракт платит, только если ценность действительно ушла.',
  'Hunt a bounty →': 'Искать награду →',
  'Launch a bounty': 'Запустить баунти',
  'Launch a bounty →': 'Запустить баунти →',
  'The replay decides. Claims and severity debates earn zero.':
    'Решает воспроизведение. Заявления и споры о критичности стоят ноль.',
  'See what it checks →': 'Что уже проверяется →',
  'An attack sealed in an envelope': 'Атака, запечатанная в конверт',
  'FROZEN RULE': 'ЗАКРЕПЛЁННОЕ ПРАВИЛО',
  'SEALED ATTACK': 'ЗАПЕЧАТАННАЯ АТАКА',
  'MEASURED VALUE': 'ИЗМЕРЕННАЯ ЦЕННОСТЬ',
  'PAID ON NEAR': 'ВЫПЛАТА В NEAR',
  'THE PROBLEM': 'ПРОБЛЕМА',
  'Bug bounties run on trust.': 'Баг-баунти держатся на доверии.',
  'Hunters wait and hope.': 'Охотники ждут и надеются.',
  'Severity is argued after the fact, and the payout depends on the project agreeing.':
    'Критичность обсуждают задним числом, а выплата зависит от согласия проекта.',
  'Projects drown in noise.': 'Проекты тонут в шуме.',
  'Reports arrive as prose and screenshots; reproducing each one costs engineer time.':
    'Отчёты приходят текстом и скриншотами; воспроизвести каждый стоит времени инженера.',
  'Exploits leak.': 'Эксплойты утекают.',
  'A working attack sent in the clear can be copied before it is fixed.':
    'Рабочую атаку, отправленную открытым текстом, могут скопировать до исправления.',
  'A bounty that pays for a measured result.': 'Награда за измеренный результат.',
  'One judge for every project: the attacker gains what a protected account loses, a protected account loses value, or a protected withdrawal stops working.':
    'Один судья для всех проектов: атакующий получает то, что теряет защищённый аккаунт, защищённый аккаунт теряет ценность или защищённый вывод средств перестаёт работать.',
  'Freeze & fund': 'Закрепить и пополнить',
  'The project fixes the code, the starting balances and what counts as a break. The reward waits in a NEAR contract.':
    'Проект закрепляет код, стартовые балансы и что считается взломом. Награда ждёт в контракте NEAR.',
  'Seal & commit': 'Зашифровать и закрепить',
  'The hunter encrypts the attack in the browser and records its hash on-chain before sending it.':
    'Охотник шифрует атаку в браузере и записывает её хеш в сеть до отправки.',
  'Replay & measure': 'Воспроизвести и измерить',
  'The verifier runs the attack on a fresh copy of the chain and measures who gained and who lost.':
    'Проверяющий запускает атаку на свежей копии сети и измеряет, кто получил и кто потерял.',
  'Settle & disclose': 'Выплатить и раскрыть команде',
  'A signed verdict settles the bounty. Only the project team can decrypt the reproduction.':
    'Подписанный вердикт запускает выплату. Воспроизведение может расшифровать только команда проекта.',
  'The replay decides.': 'Решает воспроизведение.',
  'Rule broken. Reward paid.': 'Правило нарушено. Награда выплачена.',
  'Measured on the vulnerable vault build: vault −9 NEAR, attacker +9 NEAR, threshold 0.1 NEAR. The contract pays the hunter after the signed verdict.':
    'Измерено на уязвимой сборке хранилища: хранилище −9 NEAR, атакующий +9 NEAR, порог 0.1 NEAR. После подписанного вердикта контракт платит охотнику.',
  'A story is worth zero.': 'История стоит ноль.',
  'A story, a screenshot or a failed call is not a break. The same attack on the fixed build moves nothing, so no reward is due.':
    'Рассказ, скриншот или упавший вызов - не взлом. Та же атака на исправленной сборке ничего не сдвигает, поэтому награды нет.',
  'TWO SIDES': 'ДВЕ СТОРОНЫ',
  'Pick your side.': 'Выберите сторону.',
  'FOR HUNTERS': 'ДЛЯ ОХОТНИКОВ',
  'Break it, prove it, get paid.': 'Взломай, докажи, получи выплату.',
  'Pick an open bounty, test the attack locally, seal it. The replay decides, so nobody can argue the verdict.':
    'Выберите открытую награду, проверьте атаку локально и запечатайте её. Решает воспроизведение, поэтому вердикт не оспорить.',
  'FOR PROJECTS': 'ДЛЯ ПРОЕКТОВ',
  'Pay only for proved breaks.': 'Платите только за доказанные взломы.',
  'Describe your contract, token, intents app or agent as a program. Hunters attack a fresh copy, never your live funds.':
    'Опишите контракт, токен, intents-приложение или агента как программу. Охотники атакуют свежую копию, а не ваши живые средства.',
  'Contract with deposits': 'Контракт с депозитами',
  'Fungible token': 'Токен',
  'Intents protocol': 'Протокол intents',
  'Agent wallet': 'Кошелёк агента',
  'Break proved - reward': 'Взлом доказан - награда',
  'No break - zero': 'Взлома нет - ноль',
  'Not a valid attack': 'Недопустимая атака',
  'Over the limits': 'Сверх лимитов',
  'Could not decide': 'Решить не удалось',
  'Infrastructure error': 'Ошибка инфраструктуры',
  'attacker gains what a protected account loses':
    'атакующий получает то, что теряет защищённый аккаунт',
  'a protected account loses value': 'защищённый аккаунт теряет ценность',
  'a protected withdrawal stops working': 'защищённый вывод перестаёт работать',
  'Expected: {x}': 'Ожидалось: {x}',
  Attack: 'Атака',
  vulnerable: 'уязвимая',
  fixed: 'исправленная',
  mainnet: 'код mainnet',
  'scoped key': 'ограниченный ключ',
  'full key': 'полный ключ',
  enforced: 'с контролем',
  'Vault contract': 'Контракт-хранилище',
  'Payment agent wallet': 'Кошелёк платёжного агента',
  'Own contract, two builds': 'Свой контракт, две сборки',
  'wrap.near mainnet code': 'код wrap.near из mainnet',
  'intents.near mainnet code': 'код intents.near из mainnet',
  'Policy wallet, two key setups': 'Кошелёк с политикой, два варианта ключа',
  'Deposit 1 NEAR, withdraw 10 NEAR': 'Внести 1 NEAR, вывести 10 NEAR',
  'Deposit 1 NEAR, withdraw 1 NEAR': 'Внести 1 NEAR, вывести 1 NEAR',
  'Sign as the depositor': 'Подписать от имени вкладчика',
  'Withdraw 5 wNEAR without a balance': 'Вывести 5 wNEAR без баланса',
  'Transfer 5 wNEAR without a balance': 'Перевести 5 wNEAR без баланса',
  'Wrap and unwrap 1 NEAR': 'Обернуть и развернуть 1 NEAR',
  "Withdraw the depositor's wNEAR": 'Вывести wNEAR вкладчика',
  'Execute an empty intent batch': 'Выполнить пустой пакет intents',
  'Register storage for many accounts': 'Оплатить хранилище за много аккаунтов',
  'Agent pays the attacker 2 NEAR': 'Агент платит атакующему 2 NEAR',
  'Agent key sends 15 NEAR directly': 'Ключ агента напрямую отправляет 15 NEAR',
  'Agent pays the shop 1 NEAR': 'Агент платит магазину 1 NEAR',
  'AI payment agent': 'Платёжный AI-агент',
  'Invoice-paying agent': 'Агент, оплачивающий инвойсы',
  'The model reads an invoice and calls a pay tool on a test ledger.':
    'Модель читает инвойс и вызывает инструмент оплаты на тестовом журнале.',
  'an executed payment breaks the frozen recipient or limit':
    'выполненный платёж нарушает закреплённого получателя или лимит',
  '{n} invoices × 2 configs, {m} as expected': '{n} инвойсов × 2 конфигурации, {m} как ожидалось',
  Invoice: 'Инвойс',
  'Stub model: checks the checker, not the model.':
    'Модель-заглушка: проверяет проверку, а не модель.',
  COVERAGE: 'ПОКРЫТИЕ',
  'Not only agents. Any NEAR project with value at stake.':
    'Не только агенты. Любой проект NEAR, где есть что терять.',
  '{runs} replays across {projects} projects, {matched} as expected, {breaks} breaks caught.':
    '{runs} воспроизведений по {projects} проектам, {matched} как ожидалось, поймано взломов: {breaks}.',
  'Model, prompt and tools frozen': 'Модель, промпт и инструменты закреплены',
  'What a sealed bounty can check today': 'Что sealed bounty проверяет уже сейчас',
  'Each result is a replay: a fresh local NEAR chain, the real code, one attack, and the judge that decides payouts.':
    'Каждый результат - воспроизведение: свежая локальная сеть NEAR, настоящий код, одна атака и тот же судья, что решает выплаты.',
  'Measured {date} · NEAR sandbox {v} · judge v{j} · {p}. Reproduce: npm run cli coverage':
    'Измерено {date} · NEAR sandbox {v} · судья v{j} · {p}. Повторить: npm run cli coverage',
  Next: 'Дальше',
  'OutLayer apps': 'Приложения OutLayer',
  'WASI apps that read and sign for NEAR accounts, replayed against the same local chain.':
    'WASI-приложения, которые читают и подписывают за аккаунты NEAR, на той же локальной сети.',
  'Put your project under a sealed bounty': 'Отдайте проект на sealed bounty',
  'Describe the code, who holds what, and what counts as a break. Hunters attack a fresh copy; the reward leaves escrow only for a proved break.':
    'Опишите код, у кого что лежит и что считается взломом. Охотники атакуют свежую копию; награда уходит из эскроу только за доказанный взлом.',
  'START FROM A TEMPLATE': 'НАЧНИТЕ С ШАБЛОНА',
  'AI payment agents launch from the existing program flow: npm run cli program-create':
    'Платёжные AI-агенты запускаются через текущий поток программ: npm run cli program-create',
  'YOUR CODE': 'ВАШ КОД',
  'Contract build': 'Сборка контракта',
  'Replace with your .wasm build (hashed in this browser)':
    'Заменить своей сборкой .wasm (хеш считается в браузере)',
  'Uploaded: {name}': 'Загружено: {name}',
  'WHO HOLDS WHAT': 'У КОГО ЧТО ЛЕЖИТ',
  protected: 'защищён',
  attacker: 'атакующий',
  neutral: 'нейтральный',
  system: 'система',
  'Protected accounts must not lose value to the attacker. The attacker gets one key and a budget.':
    'Защищённые аккаунты не должны терять ценность в пользу атакующего. У атакующего один ключ и бюджет.',
  'WHAT COUNTS AS A BREAK': 'ЧТО СЧИТАЕТСЯ ВЗЛОМОМ',
  'Ignore moves smaller than (NEAR)': 'Игнорировать сдвиги меньше (NEAR)',
  'Reward (NEAR)': 'Награда (NEAR)',
  'REVIEW AND EXPORT': 'ПРОВЕРКА И ЭКСПОРТ',
  'Program hash': 'Хеш программы',
  'Hunters see this hash on the bounty. Any change to code, balances or rules changes it.':
    'Охотники видят этот хеш в награде. Любое изменение кода, балансов или правил меняет его.',
  'Download program.json': 'Скачать program.json',
  reward: 'награда',
  'Write your own attack in the same format and replay it: npm run cli world-run program.json attack.json':
    'Напишите свою атаку в том же формате и прогоните её: npm run cli world-run program.json attack.json',
  'Run your own attack locally first. On-chain launch of contract programs ships with the next escrow release.':
    'Сначала прогоните свою атаку локально. Запуск программ для контрактов в сети появится в следующем релизе эскроу.',
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
  'THE ROUTE': 'МАРШРУТ',
  'THE CHECK': 'ПРОВЕРКА',
  'FINALIZED NEAR STATE': 'ФИНАЛИЗИРОВАННОЕ СОСТОЯНИЕ NEAR',
  'No open funded programs right now.': 'Сейчас нет открытых программ с наградой.',
  'Replay a contract attack locally →': 'Прогнать атаку на контракт локально →',
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
