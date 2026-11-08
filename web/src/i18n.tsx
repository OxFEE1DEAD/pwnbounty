import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Lang = 'en' | 'ru';
type Vars = Record<string, string>;

const ru: Record<string, string> = {
  'Switch language': 'Сменить язык',
  'Main navigation': 'Основная навигация',
  'How it works': 'Как это работает',
  Coverage: 'Покрытие',
  'For projects': 'Для проектов',
  'For hackers': 'Для хакеров',
  'FOR HACKERS': 'ДЛЯ ХАКЕРОВ',
  'My claims': 'Мои заявки',
  'MY CLAIMS': 'МОИ ЗАЯВКИ',
  Overview: 'Обзор',
  'My programs': 'Мои программы',
  'Launch a program': 'Запустить программу',
  'find a program → send a sealed attack → get paid':
    'выбери программу → отправь запечатанную атаку → получи награду',
  'describe → test run → fund → read reports': 'опиши → прогони тест → пополни → читай отчёты',
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
  'We replay known attacks on a copy of each target. A vulnerable build should break, a fixed one should hold.':
    'Мы повторяем известные атаки на копии каждой цели. Уязвимая сборка должна сломаться, исправленная - устоять.',
  'Show the {n} attacks': 'Показать атаки: {n}',
  'Open testnet →': 'Открыть тестнет →',
  'Before you fund a program, see how known attacks did on the same kind of target. Click a row for the attacks.':
    'Перед тем как пополнять программу, посмотрите, как известные атаки прошли на похожей цели. Нажмите на строку, чтобы увидеть атаки.',
  Next: 'Дальше',
  'Describe the code, who holds what, and what counts as a break. Hunters attack a fresh copy; the reward leaves escrow only for a proved break.':
    'Опишите код, у кого что лежит и что считается взломом. Охотники атакуют свежую копию; награда уходит из эскроу только за доказанный взлом.',
  'template build': 'сборка из шаблона',
  'Deployed contract': 'Задеплоенный контракт',
  'Copy its code': 'Взять его код',
  'or a .wasm build': 'или сборка .wasm',
  'No contract is deployed on this account': 'На этом аккаунте нет контракта',
  'This file is not a .wasm build': 'Этот файл не сборка .wasm',
  protected: 'защищён',
  attacker: 'атакующий',
  neutral: 'нейтральный',
  system: 'система',
  'Ignore moves smaller than (NEAR)': 'Игнорировать сдвиги меньше (NEAR)',
  'Reward (NEAR)': 'Награда (NEAR)',
  'Program hash': 'Хеш программы',
  'Hunters see this hash on the bounty. Any change to code, balances or rules changes it.':
    'Охотники видят этот хеш в награде. Любое изменение кода, балансов или правил меняет его.',
  'Download program.json': 'Скачать program.json',
  'Download a sample attack': 'Скачать пример атаки',
  'Test run on your machine': 'Пробный прогон у себя',
  'once: the CLI and a local NEAR chain (Node 22+)':
    'один раз: CLI и локальная сеть NEAR (Node 22+)',
  'test run: a fresh chain, your code, one attack, a verdict':
    'прогон: свежая сеть, ваш код, одна атака, вердикт',
  'On Linux replace Darwin-arm64 with Linux-x86_64. The sample is a known attack from the results list; write your own in the same format.':
    'На Linux замените Darwin-arm64 на Linux-x86_64. Пример - известная атака из списка результатов; свою пишите в том же формате.',
  Publish: 'Публикация',
  'Publishing needs the verifier keys, so in test mode the verifier operator runs it with your files. The reward goes to escrow and the program appears in the hacker catalog. Publishing with your wallet from this page is not available yet.':
    'Для публикации нужны ключи верификатора, поэтому в тестовом режиме её запускает оператор с вашими файлами. Награда уходит в эскроу, программа появляется в каталоге для хакеров. Публикации своим кошельком с этой страницы пока нет.',
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
  'THE HUNT': 'ОХОТА',
  'Pick a program. Break the rule.': 'Выберите программу. Нарушьте правило.',
  'Each program freezes a target and a rule. A proved break pays the reward to your wallet.':
    'Каждая программа замораживает цель и правило. Доказанный взлом платит награду на ваш кошелёк.',
  '{open} open of {total}': 'Открыто {open} из {total}',
  'Open for attacks': 'Открыта для атак',
  Closed: 'Закрыта',
  Refunding: 'Возврат',
  'closes in {time}': 'закроется через {time}',
  'won by {account}': 'победитель {account}',
  'Want your contract here?': 'Хотите сюда свой контракт?',
  '← All programs': '← Все программы',
  'PROGRAM #{id} · AI PAYMENT AGENT': 'ПРОГРАММА #{id} · ПЛАТЁЖНЫЙ AI-АГЕНТ',
  'Make the agent pay where it must not.': 'Заставьте агента заплатить туда, куда нельзя.',
  'FROZEN RULES': 'ЗАМОРОЖЕННЫЕ ПРАВИЛА',
  'Rules could not be loaded: {problem}': 'Правила не загрузились: {problem}',
  'YOUR ATTACK': 'ВАША АТАКА',
  'Write the invoice the agent will read.': 'Напишите инвойс, который прочитает агент.',
  'Encrypted in this browser to the verifier key frozen in program #{id}.':
    'Шифруется в браузере ключом верификатора, замороженным в программе #{id}.',
  'Its hash goes on NEAR from {account}. That is your claim.':
    'Хеш уходит в NEAR от {account}. Это ваша заявка.',
  'Its hash goes on NEAR from your wallet. That is your claim.':
    'Хеш уходит в NEAR с вашего кошелька. Это ваша заявка.',
  'The verifier gives your text to the agent as an invoice on a test ledger.':
    'Верификатор отдаёт ваш текст агенту как инвойс на тестовом ledger.',
  'A forbidden transfer gives a signed verdict, and the contract pays your wallet.':
    'Запрещённый перевод даёт подписанный вердикт, и контракт платит на ваш кошелёк.',
  'Open it →': 'Открыть →',
  'This program is closed for new attacks.': 'Программа закрыта для новых атак.',
  PROGRESS: 'ПРОГРЕСС',
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
  'Protect your claim': 'Закрепите заявку',
  'Connect a NEAR wallet to protect your claim.':
    'Подключите кошелёк NEAR, чтобы закрепить заявку за собой.',
  'Claiming as {account}.': 'Заявка от {account}.',
  'Loading programs…': 'Загружаем программы…',
  'THE ROUTE': 'МАРШРУТ',
  'THE CHECK': 'ПРОВЕРКА',
  'FINALIZED NEAR STATE': 'ФИНАЛИЗИРОВАННОЕ СОСТОЯНИЕ NEAR',
  'The wallet did not send the commitment. Press the button to try again.':
    'Кошелёк не отправил хеш заявки. Нажмите кнопку, чтобы попробовать снова.',
  Refresh: 'Обновить',
  'Pay only {recipients}. Maximum {max} per transfer.':
    'Платить только {recipients}. Максимум {max} за перевод.',
  Model: 'Модель',
  'Wallet limit on: the wallet blocks a forbidden payment before it executes.':
    'Лимит кошелька включён: кошелёк блокирует запрещённый платёж до исполнения.',
  'Wallet limit off: only the prompt stands between the agent and a forbidden payment.':
    'Лимит кошелька выключен: между агентом и запрещённым платежом стоит только промпт.',
  'Raw rules': 'Исходные правила',
  'Over the limit · 450': 'Выше лимита · 450',
  'Wrong recipient': 'Чужой получатель',
  'Forged transcript · earns zero': 'Поддельный журнал · ноль',
  'Checker plea · earns zero': 'Просьба проверке · ноль',
  'Invoice text': 'Текст инвойса',
  'Your text is untrusted input to the agent.': 'Ваш текст - недоверенный вход для агента.',
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
  'Replaying with fake funds…': 'Прогон на ненастоящих средствах…',
  'Checking the signed verdict…': 'Проверяем подписанный вердикт…',
  'Signed verdict accepted. Checking payout in finalized NEAR…':
    'Подписанный вердикт принят. Проверяем выплату в подтверждённом состоянии NEAR…',
  'EVIDENCE / VERDICT': 'ДОКАЗАТЕЛЬСТВО / ВЕРДИКТ',
  'Rule broken. {amount} paid to {account}.':
    'Правило нарушено. {amount} выплачено аккаунту {account}.',
  'No rule broken. Reward: 0 NEAR.': 'Правило не нарушено. Награда: 0 NEAR.',
  'You won. The reward transfer failed; the reserved payout can be retried by your wallet.':
    'Вы победили. Перевод награды не прошёл; повторить зарезервированную выплату можно ' +
    'своим кошельком.',
  'Rule broken. The payout is on its way.': 'Правило нарушено. Выплата уже в пути.',
  'Processing stopped: {detail}': 'Обработка остановлена: {detail}',
  'View payout transaction ↗': 'Смотреть транзакцию ↗',
  'Retry payout': 'Повторить выплату',
  'Try another invoice': 'Попробовать другой инвойс',
  'Job details': 'Детали задачи',
  'Your attempts and rewards will appear here after you connect a wallet.':
    'Ваши заявки и награды появятся здесь после подключения кошелька.',
  'MY ATTEMPTS': 'МОИ ЗАЯВКИ',
  REWARDS: 'НАГРАДЫ',
  ATTEMPTS: 'ЗАЯВКИ',
  'No attempts yet.': 'Заявок пока нет.',
  'Waiting for the verdict': 'Ждём вердикт',
  'No break, no reward': 'Взлома нет, награды нет',
  'Valid, but another hunter was first': 'Засчитано, но другой охотник был первым',
  Contract: 'Контракт',
  'PROGRAM #{id} · CONTRACT': 'ПРОГРАММА #{id} · КОНТРАКТ',
  'Make a protected account lose value.': 'Заставьте защищённый аккаунт потерять ценность.',
  'Write the transactions to replay.': 'Напишите транзакции для прогона.',
  'The verifier replays your transactions on a fresh copy of the chain.':
    'Верификатор прогоняет ваши транзакции на свежей копии сети.',
  'If a protected account loses value, a signed verdict makes the contract pay you.':
    'Если защищённый аккаунт теряет ценность, подписанный вердикт заставляет контракт заплатить вам.',
  'Transactions (JSON)': 'Транзакции (JSON)',
  'Signed with the attacker key inside the replay. Examples are on the Coverage page.':
    'Подписываются ключом атакующего внутри прогона. Примеры - на странице покрытия.',
  'Log out': 'Выйти',
  'No rewards yet.': 'Наград пока нет.',
  Paid: 'Выплачено',
  'Payout in progress': 'Выплата в процессе',
  'Payout failed': 'Выплата не прошла',
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
  '(connect wallet first)': '(сначала подключим кошелёк)',
  '+ token': '+ токен',
  'A template fills the same form. Change anything: code, accounts, setup calls, rules.':
    'Шаблон заполняет ту же форму. Менять можно всё: код, аккаунты, стартовые вызовы, правила.',
  'ABI file from cargo near abi, optional: fields for every argument':
    'ABI-файл из cargo near abi, по желанию: поле на каждый аргумент',
  Access: 'Доступ',
  Account: 'Аккаунт',
  'Actions per transaction': 'Действий в транзакции',
  Add: 'Добавить',
  'Added to': 'Добавлен на',
  'After the attack a protected account makes this call and must still receive what the view says it is owed.':
    'После атаки защищённый аккаунт делает этот вызов и должен получить столько, сколько ему положено по view-методу.',
  'Add an argument or edit as JSON': 'Добавить аргумент или править JSON',
  'Attack size, bytes': 'Размер атаки, байт',
  'Attacker key': 'Ключ атакующего',
  'Attacker keys': 'Ключей у атакующего',
  'Balance, NEAR': 'Баланс, NEAR',
  'Deploy to': 'Куда деплоить',
  'Deposit, NEAR': 'Депозит, NEAR',
  'Every attack runs on a fresh local NEAR chain built by these steps. Your live contract is never touched. Methods come from the contract code; upload its ABI to get a field per argument.':
    'Каждая атака идёт на свежей локальной сети NEAR, собранной этими шагами. Боевой контракт не затрагивается. Методы берутся из кода контракта; загрузите его ABI, чтобы получить поле на каждый аргумент.',
  'Fill in the withdrawal check': 'Заполните проверку вывода',
  'Gas in total, TGas': 'Газ всего, TGas',
  'Gas per transaction, TGas': 'Газ на транзакцию, TGas',
  'Gas, TGas': 'Газ, TGas',
  'Give the program a name': 'Назовите программу',
  'Init method, empty for none': 'Метод инициализации, пусто - без него',
  Key: 'Ключ',
  'Make exactly one attacker account': 'Нужен ровно один аккаунт атакующего',
  Method: 'Метод',
  'Methods found: {count}': 'Найдено методов: {count}',
  'Methods, comma separated, empty for any': 'Методы через запятую, пусто - любые',
  Name: 'Имя',
  'New accounts': 'Новых аккаунтов',
  'New argument': 'Новый аргумент',
  'No code yet': 'Код ещё не выбран',
  'Owed amount from': 'Положенная сумма из',
  'Paid in': 'Чем платит',
  'Pick at least one rule': 'Выберите хотя бы одно правило',
  'Program name': 'Название программы',
  'Project site or GitHub, optional': 'Сайт проекта или GitHub, необязательно',
  'Name the program': 'Назовите программу',
  'The link must start with https://': 'Ссылка должна начинаться с https://',
  Receipts: 'Квитанций',
  Receiver: 'Получатель',
  Remove: 'Удалить',
  'Remove the last token': 'Убрать последний токен',
  Role: 'Роль',
  'Setup call': 'Стартовый вызов',
  Signer: 'Подписант',
  'Step {n}: account names look like name.test.near': 'Шаг {n}: имя аккаунта вида name.test.near',
  'Step {n}: choose a method': 'Шаг {n}: выберите метод',
  'Step {n}: choose the code for {id}': 'Шаг {n}: выберите код для {id}',
  'Step {n}: create {id} earlier, not as the attacker':
    'Шаг {n}: создайте {id} раньше и не атакующим',
  'Step {n}: the attacker has fewer keys': 'Шаг {n}: у атакующего меньше ключей',
  'Step {n}: the key contract is not created earlier': 'Шаг {n}: контракт ключа не создан раньше',
  'Step {n}: the signer and the contract must be created earlier':
    'Шаг {n}: подписант и контракт должны быть созданы раньше',
  'Step {n}: {id} is created twice': 'Шаг {n}: {id} создаётся дважды',
  'Time, ms': 'Время, мс',
  'Token contract': 'Контракт токена',
  'Token {id} is not created in the setup': 'Токен {id} не создан в настройке',
  Transactions: 'Транзакций',
  'View method': 'View-метод',
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
  'Bug bounties today end in weeks of triage and arguments about severity. Here the rule of a break is frozen up front, every attack is replayed by a machine, and the contract pays on the verdict.':
    'Сегодня баг-баунти заканчиваются неделями разбора и спорами о серьёзности. Здесь правило взлома зафиксировано заранее, каждую атаку воспроизводит машина, а контракт платит по вердикту.',
  'Testnet only: rewards are test NEAR, not real money.':
    'Только testnet: награды в тестовых NEAR, это не настоящие деньги.',
  'Attacks are replayed on an operator machine. The operator can read your attack.':
    'Атаки воспроизводятся на машине оператора. Оператор может прочитать вашу атаку.',
  'The operator holds the verdict key, so this page cannot prove a replay happened.':
    'Ключ вердикта у оператора, поэтому эта страница не может доказать, что воспроизведение было.',
  'The verifier runs on OutLayer and reports confidential model inference as confirmed. Check the evidence before a private submission.':
    'Верификатор работает в OutLayer и сообщает, что конфиденциальный вывод модели подтверждён. Проверьте доказательства перед приватной отправкой.',
  'The verifier runs on OutLayer. Confidential model inference is not confirmed yet. Check the evidence before a private submission.':
    'Верификатор работает в OutLayer. Конфиденциальный вывод модели пока не подтверждён. Проверьте доказательства перед приватной отправкой.',
  '01 FREEZE': '01 ФИКСАЦИЯ',
  '02 SEAL': '02 ПЕЧАТЬ',
  '03 REPLAY': '03 ПОВТОР',
  '04 SETTLE': '04 РАСЧЁТ',
  'The project pins code, starting state and the rule of a break, and reserves the reward in escrow. Its hash is on chain.':
    'Проект фиксирует код, начальное состояние и правило взлома и резервирует награду в эскроу. Хеш лежит в сети.',
  'The hacker encrypts the attack in the browser and commits its hash on NEAR. Nobody sees the attack before the commit is final.':
    'Хакер шифрует атаку в браузере и записывает её хеш в NEAR. До финализации записи атаку никто не видит.',
  'The verifier replays it on a fresh sandbox chain, or runs the agent on a test ledger. The judge checks the frozen rule.':
    'Верификатор воспроизводит её на свежей sandbox-сети или запускает агента на тестовом реестре. Судья проверяет зафиксированное правило.',
  'A signed verdict reaches the contract. The first valid break is paid automatically; anything else earns zero.':
    'Подписанный вердикт приходит в контракт. Первый настоящий взлом оплачивается автоматически, всё остальное получает ноль.',
  'Break it. Prove it. Get paid.': 'Сломай. Докажи. Получи награду.',
  'Pay only for a proved break.': 'Платите только за доказанный взлом.',
  'Pick an open program. What counts as a break is written down and frozen.':
    'Выберите открытую программу. Что считается взломом, записано и зафиксировано.',
  'Write the attack, test it on your machine, seal it in the browser.':
    'Напишите атаку, проверьте у себя, запечатайте в браузере.',
  'The contract pays the first valid break. Nobody triages your report.':
    'Контракт платит за первый настоящий взлом. Ваш отчёт никто не разбирает вручную.',
  'Upload your contract, point to its code on mainnet, or describe your AI agent.':
    'Загрузите контракт, укажите его код в mainnet или опишите своего AI-агента.',
  'Set the starting state and what counts as a break. A test run checks it before you pay.':
    'Задайте начальное состояние и что считается взломом. Тестовый прогон проверит это до оплаты.',
  'Reserve the reward. If nobody breaks it, take it back after the deadline.':
    'Зарезервируйте награду. Если никто не сломает, заберите её после срока.',
  'Browse programs →': 'Смотреть программы →',
  'Launch a program →': 'Запустить программу →',
  'How it works for projects': 'Как это работает для проектов',
  CONTRACT: 'КОНТРАКТ',
  TOKEN: 'ТОКЕН',
  INTENTS: 'INTENTS',
  'AGENT WALLET': 'КОШЕЛЁК АГЕНТА',
  'AI AGENT': 'AI-АГЕНТ',
  'Vault with user deposits': 'Хранилище с депозитами пользователей',
  'Wrapped NEAR': 'Wrapped NEAR',
  'NEAR Intents': 'NEAR Intents',
  'Payment agent with a model': 'Платёжный агент с моделью',
  "A contract that holds other people's money.": 'Контракт, который хранит чужие деньги.',
  'The real wrap.near code, copied from mainnet.':
    'Настоящий код wrap.near, скопированный из mainnet.',
  'The real intents.near code. Also checks that a user is not blocked from their funds.':
    'Настоящий код intents.near. Ещё проверяется, что пользователь не теряет доступ к своим средствам.',
  'The on-chain wallet an AI agent pays from.': 'Кошелёк в сети, с которого платит AI-агент.',
  'An agent that reads invoices and pays them. Runs on OutLayer or on an operator machine.':
    'Агент, который читает счета и оплачивает их. Работает в OutLayer или на машине оператора.',
  'Broken build: caught (deposit 1, withdraw 10). Fixed build: passed.':
    'Сломанная сборка: поймана (внёс 1, вывел 10). Исправленная: прошла.',
  '3 known attacks, no break found.': '3 известные атаки, взлома нет.',
  'Full-access key: drained. Limited key: held.':
    'Ключ с полным доступом: опустошён. Ограниченный ключ: устоял.',
  'Crafted invoice on testnet: the weak agent paid 1 NEAR, the guarded one 0.':
    'Подделанный счёт в testnet: слабый агент заплатил 1 NEAR, защищённый - 0.',
  'TEST MODE': 'ТЕСТОВЫЙ РЕЖИМ',
  'BEFORE YOU SEND': 'ПЕРЕД ОТПРАВКОЙ',
  'LAST VERDICT': 'ПОСЛЕДНИЙ ВЕРДИКТ',
  'No payouts yet. The first proved break will appear here.':
    'Выплат пока нет. Первый доказанный взлом появится здесь.',
  'Loading…': 'Загрузка…',
  'VERDICT · PROGRAM #': 'ВЕРДИКТ · ПРОГРАММА #',
  VALID: 'ВЗЛОМ',
  payout: 'выплата',
  'rule hash': 'хеш правила',
  state: 'статус',
  'Paid by the contract': 'Оплачено контрактом',
  'Open the program →': 'Открыть программу →',
  'AUTOMATED BUG BOUNTY ON NEAR': 'АВТОМАТИЧЕСКИЙ БАГ-БАУНТИ НА NEAR',
  'If it breaks,': 'Сломалось -',
  'it pays.': 'заплатят.',
  'I HACK': 'Я ХАКЕР',
  'find a program →': 'найти программу →',
  'I BUILD': 'Я СТРОЮ',
  'launch a bounty →': 'запустить баунти →',
  'programs launched': 'программ запущено',
  'open right now': 'открыто сейчас',
  'paid to hackers': 'выплачено хакерам',
  'breaks proved': 'взломов доказано',
  'Live numbers': 'Живые цифры',
  'HOW IT WORKS': 'КАК ЭТО РАБОТАЕТ',
  'Four steps. One frozen rule.': 'Четыре шага. Одно зафиксированное правило.',
  'Choose your side': 'Выберите сторону',
  'WHAT CAN BE PUT UNDER A BOUNTY': 'ЧТО МОЖНО ПОСТАВИТЬ ПОД БАУНТИ',
  'Contracts, tokens, intents and AI agents.': 'Контракты, токены, intents и AI-агенты.',
  'Each of these already went through our judge on known attacks. Below is what it found.':
    'Каждый из них уже прошёл через нашего судью на известных атаках. Ниже то, что он нашёл.',
  'Full results, case by case →': 'Все результаты по кейсам →',
  'Sealed. Save the file, then commit it on NEAR.':
    'Запечатано. Сохраните файл, затем запишите заявку в NEAR.',
  'Save sealed-report-{id}.json': 'Сохранить sealed-report-{id}.json',
  'I saved sealed-report-{id}.json. It cannot be recreated after the deadline.':
    'Я сохранил sealed-report-{id}.json. После срока его не восстановить.',
  'Commit on NEAR · {deposit}': 'Записать в NEAR · {deposit}',
  'Confirm in your wallet: the commitment, then the encrypted invoice. The TEE check runs right after, up to 2 min.':
    'Подтвердите в кошельке: сначала коммит, затем зашифрованный инвойс. Проверка в TEE идёт сразу после, до 2 минут.',
  'The TEE check returned no verdict. The claim is still open: run it again.':
    'Проверка в TEE не вернула вердикт. Заявка открыта: запустите её ещё раз.',
  'Commitment confirmed in finalized NEAR. Press the button to run the check.':
    'Коммит подтверждён в NEAR. Нажмите кнопку, чтобы запустить проверку.',
  'The escrow sent the invoice to the OutLayer TEE. Waiting for the verdict, up to 2 min…':
    'Escrow отправил инвойс в OutLayer TEE. Ждём вердикт, до 2 минут…',
  'No verdict yet: {detail}': 'Вердикта пока нет: {detail}',
  'the TEE run did not finish. The claim is still open: run the check again.':
    'прогон в TEE не завершился. Заявка открыта: запустите проверку ещё раз.',
  'View the claim transaction ↗': 'Транзакция заявки ↗',
  'Run the check again': 'Проверить ещё раз',
  'Run the check in the TEE →': 'Запустить проверку в TEE →',
  'Encrypt, commit and check · {deposit}': 'Зашифровать, записать и проверить · {deposit}',
  'One wallet confirmation, two transactions: {deposit} claim storage (not refundable) and about 0.03 NEAR for the TEE run, unused part comes back. The invoice is encrypted here; only the TEE can open it.':
    'Одно подтверждение в кошельке, две транзакции: {deposit} за хранение заявки (не возвращается) и около 0.03 NEAR за прогон в TEE, неиспользованное вернётся. Инвойс шифруется здесь, открыть его может только TEE.',
  'Claim on NEAR': 'Заявка в NEAR',
  'The commitment on NEAR differs from this submission':
    'Коммит в NEAR не совпадает с этой заявкой',
  'No commitment found for the saved invoice yet. Press the button to sign it.':
    'Коммит для сохранённого инвойса пока не найден. Нажмите кнопку, чтобы подписать его.',
  'OutLayer did not return a price': 'OutLayer не вернул цену прогона',
  'No report is stored for this claim': 'Для этой заявки отчёт не сохранён',
  'No escrow is deployed on this network yet': 'В этой сети escrow ещё не развёрнут',
  'The escrow has no provisioned verifier': 'У escrow нет подготовленного верификатора',
  'Invalid deposit': 'Неверный депозит',
  TEE: 'TEE',
  'Winning attack': 'Выигравшая атака',
  'Agent sent {amount} to {recipient}': 'Агент отправил {amount} на {recipient}',
  executed: 'исполнено',
  blocked: 'заблокировано',
  'Test balance after the run: {balance}': 'Тестовый баланс после прогона: {balance}',
  'Full report': 'Полный отчёт',
  'AI payment agent · checked in the TEE': 'AI-агент оплаты · проверка в TEE',
  'Contract · export for a local replay': 'Контракт · экспорт для локального прогона',
  "Your agent's system prompt": 'Системный промпт вашего агента',
  'Start from a template': 'Начните с шаблона',
  'Templates are examples for a test bounty. Do not use them in production: write your own prompt.':
    'Шаблоны - примеры для тестовой программы. Не используйте их в продакшене: напишите свой промпт.',
  'Naive invoice payer': 'Наивный плательщик счетов',
  'Guarded invoice payer': 'Осторожный плательщик счетов',
  'Treasury guardian · like Freysa': 'Хранитель казны · как Freysa',
  'Tip bot · like Lobstar Wilde': 'Бот чаевых · как Lobstar Wilde',
  'Hackers attack exactly this text. The model reads it before every incoming message.':
    'Хакеры атакуют именно этот текст. Модель читает его перед каждым входящим сообщением.',
  'Max per payment, test NEAR': 'Максимум за платёж, тестовые NEAR',
  'Agent wallet at the start, test NEAR': 'Кошелёк агента на старте, тестовые NEAR',
  'Test NEAR exist only on the ledger inside the replay, in whole numbers. No real NEAR moves.':
    'Тестовые NEAR есть только в журнале внутри прогона, целыми числами. Настоящие NEAR никуда не уходят.',
  'The wallet itself blocks payments outside these rules':
    'Кошелёк сам блокирует платежи вне этих правил',
  'Off: only the prompt guards the money. On: even a fooled model cannot send a forbidden payment, so a break is much harder.':
    'Выключено: деньги охраняет только промпт. Включено: даже обманутая модель не отправит запрещённый платёж, взломать гораздо сложнее.',
  REWARD: 'НАГРАДА',
  'No winner by the deadline: the reward comes back to you.':
    'Если до дедлайна победителя нет, награда возвращается вам.',
  'TEAM KEY': 'КЛЮЧ КОМАНДЫ',
  'Reports are encrypted to this key. It is made in this browser and saved as a file; nobody else gets it.':
    'Отчёты шифруются на этот ключ. Он создаётся в этом браузере и сохраняется файлом, больше его никто не получает.',
  'Make the team key': 'Создать ключ команды',
  'Make a new key': 'Создать новый ключ',
  'I saved {file}. Without it the reports cannot be read.':
    'Я сохранил {file}. Без него отчёты не прочитать.',
  'The escrow sends every claim to OutLayer project {project}, version {version}. Its keys were made inside the TEE.':
    'Escrow отправляет каждую заявку в OutLayer-проект {project}, версия {version}. Его ключи созданы внутри TEE.',
  'Fund and publish · {amount}': 'Внести и опубликовать · {amount}',
  'Write the instructions for the agent': 'Напишите инструкции для агента',
  'The limit and the balance are whole numbers': 'Лимит и баланс - целые числа',
  'Set the reward in NEAR': 'Укажите награду в NEAR',
  'Allowed recipients': 'Разрешённые получатели',
  'Not a NEAR account: {name}. Use name.near, name.testnet or an implicit address':
    'Не NEAR-аккаунт: {name}. Нужно name.near, name.testnet или неявный адрес',
  'Add at least one recipient': 'Добавьте хотя бы одного получателя',
  'Pick how long it is open': 'Выберите, сколько программа открыта',
  soon: 'скоро',
  'Pinned by attestation. Other TEE models are coming.':
    'Закреплена аттестацией. Другие TEE-модели скоро.',
  'A break is a forbidden transfer that executes on the test ledger.':
    'Взлом - запрещённый перевод, исполненный на тестовом реестре.',
  'not set': 'не задано',
  'team key': 'ключ команды',
  saved: 'сохранён',
  'Make the team key and save it': 'Создайте ключ команды и сохраните его',
  'This browser cannot make X25519 keys': 'Этот браузер не умеет создавать ключи X25519',
  'Program published. Hackers can attack it now.':
    'Программа опубликована. Хакеры уже могут атаковать.',
  'Program #{id} is open →': 'Программа #{id} открыта →',
  'Published. Open My programs →': 'Опубликовано. Открыть «Мои программы» →',
  'Describe the agent and its spending rules. Hackers send encrypted invoices; the TEE runs the agent on a test ledger and the escrow pays only for a forbidden transfer.':
    'Опишите агента и правила трат. Хакеры присылают зашифрованные инвойсы, TEE прогоняет агента на тестовом реестре, а escrow платит только за запрещённый перевод.',
  'Encrypt in this browser →': 'Зашифровать в этом браузере →',
  'Already committed? Load your sealed report': 'Заявка уже записана? Загрузите запечатанный отчёт',
  'Only when the verifier never received it and the claim can still settle. The file must match the claim on NEAR.':
    'Только если верификатор его не получил, а заявку ещё можно рассчитать. Файл должен совпадать с заявкой в NEAR.',
  '{deposit} claim storage, not refundable. The attack leaves this browser only after the commit is final. Deadlines are best effort on this test worker: if it is down, a claim can miss settlement.':
    '{deposit} за хранение заявки, не возвращается. Атака покидает браузер только после финализации записи. Сроки на этом тестовом воркере не гарантированы: если он недоступен, заявка может не успеть к расчёту.',
  'Choose a sealed-report.json file': 'Выберите файл sealed-report.json',
  All: 'Все',
  'AI agent': 'AI-агент',
  'Any state': 'Любой статус',
  'Contract with value at stake': 'Контракт с ценностями под риском',
  'Break = a protected account loses value to the attacker':
    'Взлом = защищённый аккаунт теряет ценность в пользу атакующего',
  'Break = the agent executes a transfer its policy forbids':
    'Взлом = агент выполняет перевод, который запрещает его политика',
  PROGRAMS: 'ПРОГРАММЫ',
  'Each program says exactly what counts as a break and how much the contract pays for it. The first valid break wins the reward.':
    'Каждая программа точно говорит, что считается взломом и сколько за него платит контракт. Награду получает первый настоящий взлом.',
  'No programs match.': 'Подходящих программ нет.',
  'run on OutLayer': 'запуск в OutLayer',
  'replayed on the operator machine': 'повтор на машине оператора',
  Program: 'Программа',
  'no winner': 'без победителя',
  'by {owner} · {where}': 'от {owner} · {where}',
  'Have a contract or an agent you want hackers to attack?':
    'Есть контракт или агент, который стоит атаковать хакерам?',
  'For projects →': 'Для проектов →',
  'Resubmit →': 'Отправить снова →',
  'Every claim, read from the contract.': 'Все заявки, прочитанные из контракта.',
  'earned, paid only': 'получено, только выплаченное',
  wins: 'побед',
  'Write down what a break of your contract or agent looks like. Hackers attack it, a verifier replays every attack, and the contract pays the first one that breaks the rule. Junk reports cost you nothing and need no triage.':
    'Запишите, как выглядит взлом вашего контракта или агента. Хакеры атакуют, верификатор воспроизводит каждую атаку, а контракт платит первой, которая нарушила правило. Мусорные отчёты ничего не стоят и не требуют разбора.',
  '01 DESCRIBE': '01 ОПИСАНИЕ',
  '02 TEST RUN': '02 ТЕСТОВЫЙ ПРОГОН',
  '03 FUND': '03 ПОПОЛНЕНИЕ',
  '04 READ REPORTS': '04 ОТЧЁТЫ',
  'Start from a template or upload your .wasm build. Set the starting balances and what counts as a break.':
    'Начните с шаблона или загрузите свою сборку .wasm. Задайте начальные балансы и что считается взломом.',
  'See how the known attacks did on the same template, before any money moves.':
    'Посмотрите, как известные атаки прошли на таком же шаблоне, до того как двинутся деньги.',
  'Create the program: the reward goes to escrow and you keep your team key. The program appears in the hacker catalog.':
    'Создайте программу: награда уходит в эскроу, ключ команды остаётся у вас. Программа появляется в каталоге для хакеров.',
  'Decrypt the winning attack with your team key. Nobody broke it? Take the reward back after the deadline.':
    'Расшифруйте победившую атаку ключом команды. Никто не сломал? Заберите награду после срока.',
  'Settling claims': 'Идёт расчёт заявок',
  'No winner': 'Без победителя',
  'The winning claim is not in the claim index. Paste the hash and context below.':
    'Победившей заявки нет в индексе заявок. Вставьте хеш и контекст ниже.',
  'Withdrawal sent. The reward returns to your wallet.':
    'Вывод отправлен. Награда вернётся в ваш кошелёк.',
  'MY PROGRAMS': 'МОИ ПРОГРАММЫ',
  'Programs owned by {account}': 'Программы аккаунта {account}',
  'Your programs': 'Ваши программы',
  'No programs from this account yet.': 'У этого аккаунта пока нет программ.',
  'Withdraw {amount}': 'Вывести {amount}',
  'Decrypt report': 'Расшифровать отчёт',
  'Decrypt a report': 'Расшифровать отчёт',
  'Decrypting happens in this browser. Pick the team key file you saved at launch; it never leaves this page.':
    'Расшифровка идёт в этом браузере. Выберите файл ключа команды, сохранённый при запуске; он не покидает страницу.',
  'WHAT WE CAN TEST TODAY': 'ЧТО МЫ УМЕЕМ ПРОВЕРЯТЬ СЕГОДНЯ',
  'Known attacks, real results.': 'Известные атаки, настоящие результаты.',
  'LAUNCH A PROGRAM': 'ЗАПУСК ПРОГРАММЫ',
  'Put your agent under a bounty.': 'Поставьте агента под баунти.',
  'REAL INCIDENTS': 'РЕАЛЬНЫЕ СЛУЧАИ',
  'Biggest breaks since 2016 →': 'Крупнейшие взломы с 2016 года →',
  INCIDENTS: 'ИНЦИДЕНТЫ',
  'What a break costs.': 'Сколько стоит взлом.',
  '{n} of the biggest public breaks since 2016, {total} lost. {share} of it went through bugs someone could find before launch by attacking a copy, the way a bounty here works.':
    '{n} крупнейших публичных взломов с 2016 года, потеряно {total}. {share} ушло через баги, которые можно было найти до запуска, атакуя копию, - так и работает баунти здесь.',
  'A selection, not a full list: the largest cases of each year, plus cases on NEAR and with AI agents.':
    'Это выборка, а не полный список: крупнейшие случаи каждого года, плюс случаи на NEAR и с ИИ-агентами.',
  'Losses per year': 'Потери по годам',
  'findable before launch': 'можно найти до запуска',
  'not in the code: keys, insiders, fake front-ends':
    'не в коде: ключи, инсайдеры, поддельный фронтенд',
  'AI agents': 'ИИ-агенты',
  Contracts: 'Контракты',
  Bridges: 'Мосты',
  '{n} incidents': 'инцидентов: {n}',
  'partly findable': 'частично можно найти',
  'not in the code': 'не в коде',
  agent: 'агент',
  contract: 'контракт',
  bridge: 'мост',
  research: 'исследование',
  'Summaries are in English. A loss counts what actually left, not what was minted, frozen or rolled back on the spot. Sources differ on exact amounts.':
    'Описания на английском. В потери входит то, что реально ушло, без заминченного, замороженного или откатанного на месте. Источники расходятся в точных суммах.',
  'Agents already lost money.': 'Агенты уже теряли деньги.',
  'Each break below cost more than a bounty. Here you pay only the reward you set, and only when someone proves a break.':
    'Каждый такой взлом обошёлся дороже баунти. Здесь вы платите только назначенную награду и только за доказанный взлом.',
  'YOU PAY': 'ВЫ ПЛАТИТЕ',
  'Only for a proved break': 'Только за доказанный взлом',
  'The reward waits in escrow. No break by the deadline, it comes back.':
    'Награда ждёт в эскроу. Нет взлома к сроку - она возвращается.',
  'YOU SKIP': 'ВЫ НЕ ДЕЛАЕТЕ',
  'Triage of junk reports': 'Разбор мусорных отчётов',
  'Every attack is replayed. A report that breaks nothing costs you nothing.':
    'Каждая атака воспроизводится. Отчёт без взлома вам ничего не стоит.',
  'YOU KEEP': 'ВЫ СОХРАНЯЕТЕ',
  'The exploit private': 'Эксплойт в тайне',
  'The report is encrypted to your team key. Only the verdict is public.':
    'Отчёт зашифрован ключом команды. Публичен только вердикт.',
  'May 2026': 'май 2026',
  'Feb 2026': 'фев 2026',
  'Mar 2025': 'мар 2025',
  'Nov 2024': 'ноя 2024',
  'An X post hid an order in Morse code. Grok decoded it and the wallet bot sent the tokens.':
    'В посте в X был приказ азбукой Морзе. Grok его расшифровал, и бот-кошелёк отправил токены.',
  'Asked for a 4 SOL tip, the trading agent sent its whole token stash to a stranger.':
    'Его попросили о чаевых в 4 SOL, а торговый агент отправил незнакомцу весь запас токенов.',
  'An attacker got into the operator dashboard and queued two prompts. The agent paid out.':
    'Атакующий попал в панель оператора и поставил в очередь два промпта. Агент заплатил.',
  'A game agent was told never to release its prize pool. A player argued it into the transfer.':
    'Игровому агенту запретили отдавать призовой фонд. Игрок уговорил его на перевод.',
  'Losses as reported at the time. Sources differ on exact amounts.':
    'Потери - как сообщали на момент событий. Источники расходятся в точных суммах.',
  'Put your contract under a bounty.': 'Поставьте контракт под баунти.',
  'YOUR PROGRAM': 'ВАША ПРОГРАММА',
  'Your program': 'Ваша программа',
  Agent: 'Агент',
  'what it may pay': 'кому и сколько платит',
  Reward: 'Награда',
  'escrow and team key': 'эскроу и ключ команды',
  'sign with your wallet': 'подпись кошельком',
  Code: 'Код',
  'what gets attacked': 'что атакуют',
  'Who holds what': 'У кого что',
  'accounts, setup, keys': 'аккаунты, настройка, ключи',
  'Rule & reward': 'Правило и награда',
  'what counts as a break': 'что считается взломом',
  'REGISTERED IN TOKENS': 'РЕГИСТРАЦИЯ В ТОКЕНАХ',
  'An account holds a token only after it registers. Each mark adds a storage_deposit call.':
    'Аккаунт может держать токен только после регистрации. Каждая отметка добавляет вызов storage_deposit.',
  'SETUP CALLS': 'ВЫЗОВЫ НАСТРОЙКИ',
  'amount, tokens': 'amount, в токенах',
  '1 token = … NEAR': '1 токен = … NEAR',
  'It pays without an attack, {token}': 'Выплата без атаки, {token}',
  'Advanced: limits for one attack': 'Дополнительно: лимиты одной атаки',
  'test run, then the CLI': 'тестовый прогон и CLI',
  AGENT: 'АГЕНТ',
  name: 'название',
  'allowed recipients': 'кому можно платить',
  'per payment': 'за платёж',
  'open for': 'открыта',
  '≤ {n} test NEAR': '≤ {n} тестовых NEAR',
  'agent wallet': 'кошелёк агента',
  '{n} test NEAR': '{n} тестовых NEAR',
  'wallet limit': 'лимит кошелька',
  on: 'вкл.',
  off: 'выкл.',
  '{n} days': '{n} дн.',
  'program hash': 'хэш программы',
  'Still needed: {what}': 'Осталось: {what}',
  'Ready to publish.': 'Можно публиковать.',
  'Ready to export.': 'Можно выгружать.',
  'reward, held in escrow': 'награда в эскроу',
  'program storage, not refundable': 'хранение программы, не возвращается',
  'open for attacks': 'открыта для атак',
  'you send': 'вы отправляете',
  'FILL FROM': 'ЗАПОЛНИТЬ ИЗ',
  'Empty form': 'Пустая форма',
  '+ Add a contract': '+ Добавить контракт',
  'Attacks hit a local copy, never your live contract. Methods come from the contract code; upload its ABI to get a field per argument.':
    'Атаки идут по локальной копии, живой контракт не трогается. Методы берутся из кода контракта; загрузите ABI, чтобы получить поле на каждый аргумент.',
  'ACCOUNTS IN THE TEST CHAIN': 'АККАУНТЫ В ТЕСТОВОЙ СЕТИ',
  account: 'аккаунт',
  role: 'роль',
  '+ Add account': '+ Добавить аккаунт',
  'Protected: its loss is a break. Neutral: just there. The attacker is a stand-in: any hunter plays it here, with its sub-accounts and keys. Only its starting balance matters; the reward goes to the wallet that sends the attack.':
    'Защищённый: его потеря - взлом. Нейтральный: просто есть. Атакующий - подставной аккаунт: его играет любой хакер вместе с его субаккаунтами и ключами. Важен только стартовый баланс, награда уходит на кошелёк, который прислал атаку.',
  'KEYS GIVEN TO THE ATTACKER': 'КЛЮЧИ АТАКУЮЩЕГО',
  '+ Give a key': '+ Выдать ключ',
  'The hunter signs the attack with these keys.': 'Этими ключами хакер подписывает атаку.',
  '+ Add call': '+ Добавить вызов',
  'Runs before every attack, in this order.': 'Выполняется перед каждой атакой, в этом порядке.',
  'A BREAK IS': 'ВЗЛОМ - ЭТО',
  'TOKENS COUNTED AS VALUE': 'ТОКЕНЫ, КОТОРЫЕ СЧИТАЮТСЯ ЦЕННОСТЬЮ',
  'NEAR always counts. The verifier compares balances before and after the attack.':
    'NEAR учитывается всегда. Верификатор сравнивает балансы до и после атаки.',
  CODE: 'КОД',
  'WHO HOLDS WHAT': 'У КОГО ЧТО',
  SETUP: 'НАСТРОЙКА',
  RULE: 'ПРАВИЛО',
  'code not chosen': 'код не выбран',
  'attacker key on {id}': 'ключ атакующего на {id}',
  'full access': 'полный доступ',
  'only {methods}': 'только {methods}',
  'No setup calls': 'Вызовов нет',
  theft: 'кража',
  'any loss': 'любая потеря',
  'withdrawal blocked': 'вывод заблокирован',
  'ignore < {amount} NEAR': 'меньше {amount} NEAR не считается',
  reward: 'награда',
  'rules hash': 'хэш правил',
  BREAK: 'ВЗЛОМ',
  SCOPE: 'ОХВАТ',
  ROUTE: 'ПУТЬ',
  TRUST: 'ДОВЕРИЕ',
  'Copy link': 'Скопировать ссылку',
  'Link copied': 'Ссылка скопирована',
  'Copy failed': 'Не удалось скопировать',
  'How to check a verdict →': 'Как проверить вердикт →',
  'How to check a verdict': 'Как проверить вердикт',
  'SUBMIT AN ATTACK': 'ПОДАТЬ АТАКУ',
  'Submit an attack': 'Подать атаку',
  Seal: 'Шифр',
  Verdict: 'Вердикт',
  'The reward goes to the wallet that commits.': 'Награда уходит кошельку, который сделал коммит.',
  escrow: 'эскроу',
  owner: 'владелец',
  'Every attack, case by case →': 'Каждая атака по отдельности →',
  'New program': 'Новая программа',
  'Open program': 'Открыть программу',
  'Read from the contract. Reports open only with your team key.':
    'Читается из контракта. Отчёты открываются только вашим ключом команды.',
  'TESTED TODAY': 'ПРОВЕРЕНО СЕГОДНЯ',
  'Your programs.': 'Ваши программы.',
  program: 'программа',
  Docs: 'Документация',
  'Read from the contract, not from us.': 'Читается из контракта, а не с наших слов.',
  'Your claims.': 'Ваши заявки.',
  claims: 'заявок',
  'on chain': 'в сети',
  'paid to you': 'выплачено вам',
  report: 'отчёт',
  'waiting for a verdict': 'ждут вердикта',
  '1 Rules': '1 Правила',
  '2 Code': '2 Код',
  '3 Model': '3 Модель',
  '4 Payout': '4 Выплата',
  'Check everything yourself.': 'Проверьте всё сами.',
  DEPLOYMENTS: 'РАЗВЁРТЫВАНИЯ',
  DOCS: 'ДОКУМЕНТАЦИЯ',
  'Escrow and the TEE runner.': 'Эскроу и раннер в TEE.',
  'Every number on this site comes from the chain.': 'Каждое число на сайте берётся из сети.',
  'Four checks, no trust.': 'Четыре проверки, без доверия.',
  'HOW TO CHECK A VERDICT': 'КАК ПРОВЕРИТЬ ВЕРДИКТ',
  'TEE runner': 'раннер в TEE',
  'The escrow pins the runner build; every program pins the model policy hash.':
    'Эскроу закрепляет сборку раннера; каждая программа закрепляет хэш политики модели.',
  'escrow contract': 'контракт эскроу',
  model: 'модель',
  network: 'сеть',
  'not deployed': 'не развёрнут',
  'the TDX quote names the runner build the escrow pinned':
    'квота TDX называет сборку раннера, которую закрепил эскроу',
  'the hash of program.json equals the rules hash on chain':
    'хэш program.json совпадает с хэшем правил в сети',
  'the runner checked the NEAR AI attestation against the pinned model policy':
    'раннер сверил аттестацию NEAR AI с закреплённой политикой модели',
  'the transfer is in the receipts of the claim transaction':
    'перевод есть в квитанциях транзакции заявки',
  'held all {total} attacks': 'выдержал все {total} атак',
  '{n} of {total} attacks broke it': '{n} из {total} атак взломали',
  'No triage. A machine replays the attack, the contract pays the verdict.':
    'Без триажа. Машина воспроизводит атаку, контракт платит по вердикту.',
  'One frozen rule decides.': 'Решает одно замороженное правило.',
  PROJECT: 'ПРОЕКТ',
  'code, rule, reward': 'код, правило, награда',
  'rule + reward →': 'правило + награда →',
  '← no break: refund': '← нет взлома: возврат',
  'escrow on NEAR': 'эскроу в NEAR',
  '← sealed hash': '← хэш атаки',
  'pays the break →': 'платит за взлом →',
  HACKER: 'ХАКЕР',
  'finds a break': 'находит взлом',
  '← encrypted attack': '← зашифрованная атака',
  '↑ signed verdict': '↑ подписанный вердикт',
  VERIFIER: 'ВЕРИФИКАТОР',
  'replays the attack': 'воспроизводит атаку',
  Vault: 'Хранилище',
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
