export type Lang = 'hr' | 'en';

export interface TranslationShape {
  appTitle: string;
  nav: {
    dashboard: string;
    shifts: string;
    machines: string;
    progress: string;
    gantt: string;
    workOrders: string;
    admin: string;
  };
  common: {
    calculate: string;
    print: string;
    add: string;
    remove: string;
    save: string;
    name: string;
    status: string;
    start: string;
    end: string;
    progressLabel: string;
    department: string;
    documentDate: string;
    createdBy: string;
    language: string;
  };
  shifts: {
    wizardTitle: string;
    wizardSubtitle: string;
    step2: string;
    step3: string;
    base: string;
    always1: string;
    g1: string;
    g2: string;
    startWeek: string;
    weekCount: string;
    startDate: string;
    docTitle: string;
    dept: string;
    author: string;
    week: string;
    from: string;
    shift1: string;
    shift2: string;
  };
  machines: {
    title: string;
    subtitle: string;
    machine: string;
    order: string;
    operator: string;
    addJob: string;
    noJobs: string;
    hours: string;
    sharedNote: string;
    selectMachine: string;
    noMachinesDefined: string;
    typeMill: string;
    typeLathe: string;
    axisShort: string;
  };
  progress: {
    title: string;
    subtitle: string;
    task: string;
    addTask: string;
    sharedNote: string;
    viewList: string;
    viewBoard: string;
    statusOptions: {
      planned: string;
      inProgress: string;
      done: string;
      delayed: string;
    };
  };
  dashboard: {
    title: string;
    subtitle: string;
    totalJobs: string;
    avgProgress: string;
    statusBreakdown: string;
    recentJobs: string;
    noJobs: string;
  };
  gantt: {
    title: string;
    subtitle: string;
    today: string;
    sharedNote: string;
    dependencies: string;
    addDependency: string;
    predecessor: string;
    dependencyType: string;
    lagHours: string;
    noDependencies: string;
    criticalPathLegend: string;
    typeFS: string;
    typeSS: string;
    typeFF: string;
    typeSF: string;
    selectPredecessor: string;
    dependencyError: string;
  };
  workOrders: {
    title: string;
    subtitle: string;
    orderInfo: string;
    orderNumber: string;
    product: string;
    startDateTime: string;
    buildRoute: string;
    operationName: string;
    operationMachine: string;
    operationHours: string;
    addOperation: string;
    noOperations: string;
    totalHours: string;
    createOrder: string;
    created: string;
    missingFields: string;
    createdOrders: string;
    noCreatedOrders: string;
    print: string;
    printTitle: string;
    closePreview: string;
    opNumber: string;
    parentOrder: string;
    noParent: string;
  };
  login: {
    title: string;
    subtitle: string;
    username: string;
    password: string;
    submit: string;
    error: string;
    logout: string;
  };
  admin: {
    title: string;
    subtitle: string;
    logoSection: string;
    uploadLogo: string;
    currentLogo: string;
    noLogo: string;
    save: string;
    saved: string;
    clear: string;
    usersSection: string;
    username: string;
    password: string;
    addUser: string;
    editUser: string;
    cancelEdit: string;
    edit: string;
    delete: string;
    userExists: string;
    cannotDeleteSelf: string;
    cannotDeleteLast: string;
    machinesSection: string;
    machineName: string;
    machineType: string;
    machineAxis: string;
    addMachine: string;
    editMachine: string;
    machineExists: string;
    noMachines: string;
  };
  roles: {
    title: string;
    roleName: string;
    addRole: string;
    noRole: string;
  };
}

export const translations: Record<Lang, TranslationShape> = {
  hr: {
    appTitle: 'Drava International - Planer',
    nav: {
      dashboard: 'Pregled',
      shifts: 'Raspored smjena',
      machines: 'Raspored strojeva',
      progress: 'Praćenje napretka',
      gantt: 'Gantogram',
      workOrders: 'Kreator radnih naloga',
      admin: 'Administracija',
    },
    common: {
      calculate: '1. Izračunaj i ažuriraj',
      print: '2. Isprintaj / PDF',
      add: 'Dodaj',
      remove: 'Ukloni',
      save: 'Spremi',
      name: 'Naziv',
      status: 'Status',
      start: 'Početak',
      end: 'Kraj',
      progressLabel: 'Napredak',
      department: 'Odjel',
      documentDate: 'Datum dokumenta',
      createdBy: 'Dokument izradio',
      language: 'Jezik',
    },
    shifts: {
      wizardTitle: 'Čarobnjak za izradu rasporeda',
      wizardSubtitle: 'Prilagođeno za sve ekrane. Unesite podatke i isprintajte A4 dokument.',
      step2: 'Provjerite popise radnika',
      step3: 'Postavke tjedana i datuma',
      base: 'Mijenjaju 2. smjenu (1 po 1):',
      always1: 'Uvijek u 1. smjeni:',
      g1: 'Grupa 1 (izmjena):',
      g2: 'Grupa 2 (izmjena):',
      startWeek: 'Početni broj tjedna:',
      weekCount: 'Koliko tjedana napraviti:',
      startDate: 'Datum početka (od):',
      docTitle: 'Raspored smjena',
      dept: 'Alatnica',
      author: 'Dorian Turk',
      week: 'TJEDAN',
      from: 'od',
      shift1: '1. SMJENA',
      shift2: '2. SMJENA',
    },
    machines: {
      title: 'Raspored strojeva',
      subtitle: 'Planiranje zauzetosti strojeva po nalozima i vremenskim terminima.',
      machine: 'Stroj',
      order: 'Radni nalog',
      operator: 'Operater',
      addJob: 'Dodaj nalog',
      noJobs: 'Nema zakazanih naloga.',
      hours: 'h',
      sharedNote: 'Ovi podaci su zajednički s karticama Praćenje napretka i Gantogram.',
      selectMachine: '-- odaberite stroj --',
      noMachinesDefined: 'Nema definiranih strojeva. Zamolite administratora da ih doda.',
      typeMill: 'Glodalica',
      typeLathe: 'Tokarilica',
      axisShort: 'osna',
    },
    progress: {
      title: 'Praćenje napretka',
      subtitle: 'Pregled statusa svih aktivnih zadataka i naloga.',
      task: 'Zadatak',
      addTask: 'Dodaj zadatak',
      sharedNote: 'Podaci su zajednički s Rasporedom strojeva i Gantogramom — izmjene ovdje vidljive su i tamo.',
      viewList: 'Popis',
      viewBoard: 'Ploča',
      statusOptions: {
        planned: 'Planirano',
        inProgress: 'U tijeku',
        done: 'Završeno',
        delayed: 'Kašnjenje',
      },
    },
    gantt: {
      title: 'Gantogram',
      subtitle: 'Vremenski prikaz svih zadataka i naloga.',
      today: 'Danas',
      sharedNote: 'Prikazuje iste naloge kao Raspored strojeva i Praćenje napretka.',
      dependencies: 'Ovisnosti',
      addDependency: 'Dodaj ovisnost',
      predecessor: 'Prethodni zadatak',
      dependencyType: 'Tip ovisnosti',
      lagHours: 'Odgoda (h)',
      noDependencies: 'Nema definiranih ovisnosti.',
      criticalPathLegend: 'Crveni obrub označava kritični put (critical path) — kašnjenje ovih naloga pomiče cijeli projekt.',
      typeFS: 'Kraj → Početak',
      typeSS: 'Početak → Početak',
      typeFF: 'Kraj → Kraj',
      typeSF: 'Početak → Kraj',
      selectPredecessor: '-- odaberite prethodni zadatak --',
      dependencyError: 'Odaberite zadatak i drugačiji prethodni zadatak.',
    },
    dashboard: {
      title: 'Pregled',
      subtitle: 'Sažetak svih naloga i njihovog statusa na jednom mjestu.',
      totalJobs: 'Ukupno naloga',
      avgProgress: 'Prosječni napredak',
      statusBreakdown: 'Naloga po statusu',
      recentJobs: 'Najnoviji nalozi',
      noJobs: 'Još nema naloga u sustavu.',
    },
    workOrders: {
      title: 'Kreator radnih naloga',
      subtitle: 'Sastavite slijed operacija (blok dijagram) i od njega izradite radni nalog.',
      orderInfo: 'Podaci o nalogu',
      orderNumber: 'Broj naloga',
      product: 'Proizvod / opis',
      startDateTime: 'Početak izvođenja',
      buildRoute: 'Sastavite slijed operacija',
      operationName: 'Naziv operacije',
      operationMachine: 'Stroj',
      operationHours: 'Trajanje (h)',
      addOperation: 'Dodaj operaciju',
      noOperations: 'Slijed je prazan. Dodajte prvu operaciju.',
      totalHours: 'Ukupno trajanje',
      createOrder: 'Kreiraj radni nalog',
      created: 'Radni nalog je kreiran i vidljiv je u Rasporedu strojeva, Praćenju napretka i Gantogramu.',
      missingFields: 'Unesite broj naloga i barem jednu operaciju.',
      createdOrders: 'Kreirani nalozi',
      noCreatedOrders: 'Još nema kreiranih naloga.',
      print: 'Ispis',
      printTitle: 'RADNI NALOG',
      closePreview: 'Zatvori pregled',
      opNumber: 'R.br.',
      parentOrder: 'Nadređeni radni nalog',
      noParent: '(bez nadređenog - glavni nalog)',
    },
    login: {
      title: 'Prijava',
      subtitle: 'Unesite korisničko ime i lozinku za pristup planeru.',
      username: 'Korisničko ime',
      password: 'Lozinka',
      submit: 'Prijavi se',
      error: 'Pogrešno korisničko ime ili lozinka.',
      logout: 'Odjava',
    },
    admin: {
      title: 'Administracija',
      subtitle: 'Upravljanje logotipom tvrtke i korisničkim računima.',
      logoSection: 'Logotip tvrtke',
      uploadLogo: 'Učitajte logotip',
      currentLogo: 'Trenutni logotip:',
      noLogo: 'Logotip nije postavljen.',
      save: 'Spremi logotip',
      saved: 'Logotip spremljen.',
      clear: 'Ukloni logotip',
      usersSection: 'Korisnički računi',
      username: 'Korisničko ime',
      password: 'Lozinka',
      addUser: 'Dodaj korisnika',
      editUser: 'Spremi izmjene',
      cancelEdit: 'Odustani',
      edit: 'Uredi',
      delete: 'Obriši',
      userExists: 'Korisničko ime već postoji.',
      cannotDeleteSelf: 'Ne možete obrisati vlastiti račun.',
      cannotDeleteLast: 'Mora postojati barem jedan korisnik.',
      machinesSection: 'Strojevi',
      machineName: 'Naziv stroja',
      machineType: 'Tip',
      machineAxis: 'Broj osi',
      addMachine: 'Dodaj stroj',
      editMachine: 'Spremi izmjene',
      machineExists: 'Stroj s tim nazivom već postoji.',
      noMachines: 'Još nema definiranih strojeva.',
    },
    roles: {
      title: 'Uloge radnika',
      roleName: 'Naziv uloge',
      addRole: 'Dodaj ulogu',
      noRole: '(bez uloge)',
    },
  },
  en: {
    appTitle: 'Drava International - Planner',
    nav: {
      dashboard: 'Dashboard',
      shifts: 'Shift Schedule',
      machines: 'Machine Scheduling',
      progress: 'Progress Monitoring',
      gantt: 'Gantt Chart',
      workOrders: 'Work Order Creator',
      admin: 'Admin',
    },
    common: {
      calculate: '1. Calculate and update',
      print: '2. Print / PDF',
      add: 'Add',
      remove: 'Remove',
      save: 'Save',
      name: 'Name',
      status: 'Status',
      start: 'Start',
      end: 'End',
      progressLabel: 'Progress',
      department: 'Department',
      documentDate: 'Document date',
      createdBy: 'Created by',
      language: 'Language',
    },
    shifts: {
      wizardTitle: 'Schedule Generator Wizard',
      wizardSubtitle: 'Adapted for all screens. Enter the data and print the A4 document.',
      step2: 'Check worker lists',
      step3: 'Week and date settings',
      base: 'Rotate 2nd shift (1 by 1):',
      always1: 'Always in 1st shift:',
      g1: 'Group 1 (rotation):',
      g2: 'Group 2 (rotation):',
      startWeek: 'Starting week number:',
      weekCount: 'How many weeks to generate:',
      startDate: 'Start date (from):',
      docTitle: 'Shift Schedule',
      dept: 'Toolshop',
      author: 'Dorian Turk',
      week: 'WEEK',
      from: 'from',
      shift1: '1ST SHIFT',
      shift2: '2ND SHIFT',
    },
    machines: {
      title: 'Machine Scheduling',
      subtitle: 'Plan machine utilization by work orders and time slots.',
      machine: 'Machine',
      order: 'Work order',
      operator: 'Operator',
      addJob: 'Add job',
      noJobs: 'No jobs scheduled.',
      hours: 'h',
      sharedNote: 'This data is shared with the Progress Monitoring and Gantt Chart tabs.',
      selectMachine: '-- select a machine --',
      noMachinesDefined: 'No machines defined yet. Ask an admin to add some.',
      typeMill: 'Mill',
      typeLathe: 'Lathe',
      axisShort: 'axis',
    },
    progress: {
      title: 'Progress Monitoring',
      subtitle: 'Overview of the status of all active tasks and orders.',
      task: 'Task',
      addTask: 'Add task',
      sharedNote: 'Shared with Machine Scheduling and the Gantt Chart — edits here show up there too.',
      viewList: 'List',
      viewBoard: 'Board',
      statusOptions: {
        planned: 'Planned',
        inProgress: 'In progress',
        done: 'Done',
        delayed: 'Delayed',
      },
    },
    gantt: {
      title: 'Gantt Chart',
      subtitle: 'Timeline view of all tasks and orders.',
      today: 'Today',
      sharedNote: 'Shows the same jobs as Machine Scheduling and Progress Monitoring.',
      dependencies: 'Dependencies',
      addDependency: 'Add dependency',
      predecessor: 'Predecessor',
      dependencyType: 'Dependency type',
      lagHours: 'Lag (h)',
      noDependencies: 'No dependencies defined.',
      criticalPathLegend: 'Red outline marks the critical path — delaying these jobs delays the whole project.',
      typeFS: 'Finish → Start',
      typeSS: 'Start → Start',
      typeFF: 'Finish → Finish',
      typeSF: 'Start → Finish',
      selectPredecessor: '-- select a predecessor --',
      dependencyError: 'Select a task and a different predecessor task.',
    },
    dashboard: {
      title: 'Dashboard',
      subtitle: 'A summary of all orders and their status in one place.',
      totalJobs: 'Total orders',
      avgProgress: 'Average progress',
      statusBreakdown: 'Orders by status',
      recentJobs: 'Recent orders',
      noJobs: 'No orders in the system yet.',
    },
    workOrders: {
      title: 'Work Order Creator',
      subtitle: 'Build a sequence of operations (block diagram) and turn it into a work order.',
      orderInfo: 'Order details',
      orderNumber: 'Order number',
      product: 'Product / description',
      startDateTime: 'Start time',
      buildRoute: 'Build the operation sequence',
      operationName: 'Operation name',
      operationMachine: 'Machine',
      operationHours: 'Duration (h)',
      addOperation: 'Add operation',
      noOperations: 'The sequence is empty. Add the first operation.',
      totalHours: 'Total duration',
      createOrder: 'Create work order',
      created: 'Work order created and visible in Machine Scheduling, Progress Monitoring, and the Gantt Chart.',
      missingFields: 'Enter an order number and at least one operation.',
      createdOrders: 'Created orders',
      noCreatedOrders: 'No orders created yet.',
      print: 'Print',
      printTitle: 'WORK ORDER',
      closePreview: 'Close preview',
      opNumber: 'No.',
      parentOrder: 'Parent work order',
      noParent: '(no parent - top-level order)',
    },
    login: {
      title: 'Sign in',
      subtitle: 'Enter your username and password to access the planner.',
      username: 'Username',
      password: 'Password',
      submit: 'Sign in',
      error: 'Incorrect username or password.',
      logout: 'Log out',
    },
    admin: {
      title: 'Admin',
      subtitle: 'Manage the company logo and user accounts.',
      logoSection: 'Company logo',
      uploadLogo: 'Upload logo',
      currentLogo: 'Current logo:',
      noLogo: 'No logo set.',
      save: 'Save logo',
      saved: 'Logo saved.',
      clear: 'Remove logo',
      usersSection: 'User accounts',
      username: 'Username',
      password: 'Password',
      addUser: 'Add user',
      editUser: 'Save changes',
      cancelEdit: 'Cancel',
      edit: 'Edit',
      delete: 'Delete',
      userExists: 'That username already exists.',
      cannotDeleteSelf: 'You cannot delete your own account.',
      cannotDeleteLast: 'There must be at least one user.',
      machinesSection: 'Machines',
      machineName: 'Machine name',
      machineType: 'Type',
      machineAxis: 'Axis count',
      addMachine: 'Add machine',
      editMachine: 'Save changes',
      machineExists: 'A machine with that name already exists.',
      noMachines: 'No machines defined yet.',
    },
    roles: {
      title: 'Worker roles',
      roleName: 'Role name',
      addRole: 'Add role',
      noRole: '(no role)',
    },
  },
};
