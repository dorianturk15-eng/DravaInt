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
    /** BCP-47 tag for toLocaleString — data, not copy. */
    locale: string;
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
    typeSaw: string;
    typeQc: string;
    typeOther: string;
    axisShort: string;
  };
  machineBoard: {
    zoomHour: string;
    zoomShift: string;
    zoomDay: string;
    zoomWeek: string;
    sortByName: string;
    sortByLoad: string;
    connectMode: string;
    connectModeHint: string;
    scrollToday: string;
    emptyLane: string;
    undo: string;
    redo: string;
    conflicts: string;
    deleteConnection: string;
    cycleBlocked: string;
    dropInvalidSelf: string;
    dropInvalidDuplicate: string;
    dragHint: string;
    sequentialRouteHint: string;
    chainSegmentHint: string;
    filterAll: string;
    autoSchedule: string;
    exportCsv: string;
    exportPng: string;
    jumpToConflict: string;
    chainSelected: string;
    chainSelectedHint: string;
    savedViews: string;
    viewNamePlaceholder: string;
    saveView: string;
    deleteView: string;
    search: string;
    searchPlaceholder: string;
    conflictsTitle: string;
    noConflicts: string;
    shiftLater: string;
    moveTo: string;
    viewInGantt: string;
    overlaps: string;
    noFreeMachine: string;
    orderGone: string;
    hideEmpty: string;
    collapseLane: string;
    more: string;
    legend: string;
    legendOperation: string;
    legendChain: string;
    legendConflict: string;
    legendNow: string;
    showOnBoard: string;
    quickCreateTitle: string;
    quickCreateDuration: string;
    quickCreateCreate: string;
    quickCreateMore: string;
    addManually: string;
    emptyBoard: string;
    emptyBoardLink: string;
    noMachinesTitle: string;
    noMachinesLink: string;
    coachMove: string;
    coachLane: string;
    coachResize: string;
    coachDismiss: string;
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
    missingStartDateTime: string;
    createdOrders: string;
    noCreatedOrders: string;
    print: string;
    printTitle: string;
    closePreview: string;
    opNumber: string;
    parentOrder: string;
    noParent: string;
    edit: string;
    editingOrder: string;
    saveChanges: string;
    cancelEdit: string;
    updated: string;
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
  shiftPlanner: {
    noActiveShiftDefinitions: string;
    noWorkersDatabaseAdd: string;
    scheduleGenerationFailed: string;
    pdfExportFailed: string;
    capacityPlanning: string;
    interactiveShiftRotationWith: string;
    synced: string;
    planner: string;
    publishedSchedules: string;
    publishedScheduleArchive: string;
    everyPublishSavesPermanent: string;
    noPublishedSchedulesYet: string;
    week: string;
    hideVersions: string;
    versionsShowAll: string;
    singleVersion: string;
    current: string;
    assignments: string;
    view: string;
    editPlanner: string;
    planStartMonday: string;
    weeks: string;
    department: string;
    generating: string;
    generate: string;
    saveDraft: string;
    buildingPdf: string;
    showWeekendSatSun: string;
    weekendsNotAutoFilled: string;
    scheduleSaved: string;
    activeWorkers: string;
    absences: string;
    selectWorker: string;
    add: string;
    showHours: string;
    hideEmpty: string;
    published: string;
    unpublished: string;
    draft: string;
    changedSincePublishRe: string;
    modified: string;
    edit: string;
    publish: string;
    publishedScheduleLockedEdit: string;
    restWeeklyHoursConflict: string;
    restPeriodWarning: string;
    warningWorkerHasRecorded: string;
    overrides: string;
    weekDetailDayLevel: string;
    publishedSnapshotReadOnly: string;
    publishedBy: string;
    close: string;
  };
  appShell: {
    workstationOffline: string;
    changesStoredLocallyWill: string;
    changesWaitingSync: string;
    dueTimeHasPassed: string;
    materialAvailabilityRisk: string;
    machineScheduleOverlap: string;
    atLeastTwoOrders: string;
    capacityThresholdReached: string;
    todaySAbsence: string;
    operationsStable: string;
    noActiveDelaysConflicts: string;
    navigation: string;
    quickActions: string;
    openModule: string;
    newWorkOrder: string;
    startOrderCreationPrinting: string;
    planShifts: string;
    generatePublishSchedule: string;
    workstationSettings: string;
    appearanceSecurityPlanning: string;
    lockNow: string;
    secureCurrentWorkstation: string;
    keepConnected: string;
    yourRoleCannotAccess: string;
    mainNavigation: string;
    openMenu: string;
    commandPaletteCtrlK: string;
    search: string;
    online: string;
    offline: string;
    text: string;
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
    appShell: {
      workstationOffline: 'Radna stanica je izvan mreže',
      changesStoredLocallyWill: 'Promjene se čuvaju lokalno i sinkronizirat će se nakon povratka veze.',
      changesWaitingSync: 'Promjene čekaju sinkronizaciju',
      dueTimeHasPassed: 'Rok je probijen ili je nalog označen kao kašnjenje.',
      materialAvailabilityRisk: 'Rizik dostupnosti materijala',
      machineScheduleOverlap: 'Preklapanje na stroju',
      atLeastTwoOrders: 'Najmanje dva naloga koriste isti stroj u preklapajućem terminu.',
      capacityThresholdReached: 'Prag kapaciteta je dosegnut',
      todaySAbsence: 'Današnja odsutnost',
      operationsStable: 'Operacije su stabilne',
      noActiveDelaysConflicts: 'Nema aktivnih kašnjenja, konflikata ili problema sa sinkronizacijom.',
      navigation: 'Navigacija',
      quickActions: 'Brze radnje',
      openModule: 'Otvori modul',
      newWorkOrder: 'Novi radni nalog',
      startOrderCreationPrinting: 'Pokreni izradu i ispis naloga',
      planShifts: 'Planiraj smjene',
      generatePublishSchedule: 'Generiraj i objavi raspored',
      workstationSettings: 'Postavke radne stanice',
      appearanceSecurityPlanning: 'Izgled, sigurnost i planiranje',
      lockNow: 'Zaključaj sada',
      secureCurrentWorkstation: 'Zaštiti trenutnu radnu stanicu',
      keepConnected: 'Ostani povezan',
      yourRoleCannotAccess: 'Nemate ovlasti za ovaj modul.',
      mainNavigation: 'Glavna navigacija',
      openMenu: 'Otvori izbornik',
      commandPaletteCtrlK: 'Paleta naredbi (Ctrl+K)',
      search: 'Traži',
      online: 'Povezano',
      offline: 'Izvan mreže',
      text: ' active',
    },
    shiftPlanner: {
      noActiveShiftDefinitions: 'Nema aktivnih smjena — dodajte ih u postavkama smjena.',
      noWorkersDatabaseAdd: 'Nema radnika u bazi — dodajte radnike u Adminu prije generiranja.',
      scheduleGenerationFailed: 'Generiranje nije uspjelo.',
      pdfExportFailed: 'Izrada PDF-a nije uspjela.',
      capacityPlanning: 'Planiranje kapaciteta',
      interactiveShiftRotationWith: 'Interaktivna rotacija smjena s provjerom odmora, izostanaka i tjednih sati.',
      synced: 'Sinkronizirano',
      planner: 'Planer',
      publishedSchedules: 'Objavljeni rasporedi',
      publishedScheduleArchive: 'Arhiva objavljenih rasporeda',
      everyPublishSavesPermanent: 'Svaka objava sprema trajnu snimku — točno ono što je izdano i ispisano. Snimke se ne mijenjaju; izmjena tjedna stvara novu verziju.',
      noPublishedSchedulesYet: 'Još nema objavljenih rasporeda. Objavite tjedan u planeru i pojavit će se ovdje.',
      week: 'tjedan',
      hideVersions: 'Sakrij verzije',
      versionsShowAll: 'verzija — prikaži sve',
      singleVersion: '1 verzija',
      current: 'aktualno',
      assignments: 'dodjela',
      view: 'Pregled',
      editPlanner: 'Uredi u planeru',
      planStartMonday: 'Početak plana (ponedjeljak)',
      weeks: 'Broj tjedana',
      department: 'Odjel',
      generating: 'Generiranje…',
      generate: 'Generiraj',
      saveDraft: 'Spremi nacrt',
      buildingPdf: 'Izrada PDF-a…',
      showWeekendSatSun: 'Prikaži vikend (sub/ned)',
      weekendsNotAutoFilled: 'Vikend se ne rotira automatski — dodijelite ga ručno.',
      scheduleSaved: 'Raspored je spremljen.',
      activeWorkers: 'Aktivni radnici',
      absences: 'Izostanci',
      selectWorker: 'Odaberi radnika',
      add: 'Dodaj',
      showHours: 'Prikaži sate',
      hideEmpty: 'Sakrij prazno',
      published: 'objavljeno',
      unpublished: 'neobjavljeno',
      draft: 'nacrt',
      changedSincePublishRe: 'Izmijenjeno nakon objave — ponovno objavite za novu verziju',
      modified: 'izmijenjeno',
      edit: 'Uredi',
      publish: 'Objavi',
      publishedScheduleLockedEdit: 'Objavljeni raspored je zaključan. „Uredi” ga vraća u nacrt dok ga ponovno ne objavite. Objavljena verzija ostaje trajno sačuvana u arhivi.',
      restWeeklyHoursConflict: 'Sukob odmora ili tjednih sati',
      restPeriodWarning: ' · Upozorenje: odmor između smjena',
      warningWorkerHasRecorded: ' · Upozorenje: radnik ima evidentiranu odsutnost',
      overrides: 'ručnih izmjena',
      weekDetailDayLevel: 'Detalji tjedna — uređivanje po danima. Povucite radnika u drugu ćeliju za ručnu izmjenu. Dvostruki klik otvara brzo pretraživo prebacivanje. Ponovni klik na broj tjedna zatvara detalje.',
      publishedSnapshotReadOnly: 'Objavljena snimka — samo za čitanje',
      publishedBy: 'objavio',
      close: 'Zatvori',
    },
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
      locale: 'hr-HR',
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
      typeSaw: 'Pila',
      typeQc: 'Kontrola kvalitete',
      typeOther: 'Ostalo',
      axisShort: 'osna',
    },
    machineBoard: {
      zoomHour: 'Sat',
      zoomShift: 'Smjena',
      zoomDay: 'Dan',
      zoomWeek: 'Tjedan',
      sortByName: 'Naziv',
      sortByLoad: 'Opterećenje',
      connectMode: 'Način povezivanja',
      connectModeHint: 'Dodirnite izvorni nalog, zatim ciljni nalog za stvaranje ovisnosti.',
      scrollToday: 'Danas',
      emptyLane: 'Nema naloga na ovom stroju.',
      undo: 'Poništi',
      redo: 'Ponovi',
      conflicts: 'Upozorenja',
      deleteConnection: 'Ukloni vezu',
      cycleBlocked: 'Ova veza stvara kružnu ovisnost.',
      dropInvalidSelf: 'Nalog se ne može povezati sam sa sobom.',
      dropInvalidDuplicate: 'Ova veza već postoji.',
      dragHint: 'Povucite karticu za promjenu termina ili stroja. Povucite iz ruba kartice za povezivanje naloga.',
      sequentialRouteHint: 'Ova operacija je dio slijedne rute — povucite prvu operaciju za pomak naloga ili uredite u Ganttu.',
      chainSegmentHint: 'Naslijeđeni lanac strojeva — uredite nalog u Kreatoru radnih naloga za promjenu strojeva.',
      filterAll: 'Sve',
      autoSchedule: 'Automatski rasporedi',
      exportCsv: 'Izvoz CSV',
      exportPng: 'Izvoz PNG',
      jumpToConflict: 'Na konflikt',
      chainSelected: 'Poveži odabrane',
      chainSelectedHint: 'Poveže odabrane naloge Kraj→Početak redoslijedom početka.',
      savedViews: 'Spremljeni pogledi',
      viewNamePlaceholder: 'Naziv pogleda…',
      saveView: 'Spremi pogled',
      deleteView: 'Obriši pogled',
      search: 'Traži',
      searchPlaceholder: 'Nalog ili operacija…',
      conflictsTitle: 'Konflikti',
      noConflicts: 'Nema konflikata',
      shiftLater: 'Pomakni kasnije',
      moveTo: 'Premjesti na…',
      viewInGantt: 'Prikaži u Ganttu',
      overlaps: 'preklapa',
      noFreeMachine: 'Nema slobodnog stroja iste vrste',
      orderGone: 'Nalog više nije na ploči.',
      hideEmpty: 'Sakrij prazne',
      collapseLane: 'Sažmi/proširi liniju',
      more: 'Više',
      legend: 'Legenda',
      legendOperation: 'Operacija rute',
      legendChain: 'Naslijeđeni lanac',
      legendConflict: 'Preklapanje strojeva',
      legendNow: 'Sada',
      showOnBoard: 'Prikaži na rasporedu strojeva',
      quickCreateTitle: 'Brzo dodaj',
      quickCreateDuration: 'Trajanje (h)',
      quickCreateCreate: 'Kreiraj',
      quickCreateMore: 'Više opcija → Kreator radnih naloga',
      addManually: 'Ručni unos',
      emptyBoard: 'Dvaput kliknite na liniju stroja za planiranje rada ili kreirajte nalog s rutom u Kreatoru radnih naloga.',
      emptyBoardLink: 'Otvori Kreator radnih naloga →',
      noMachinesTitle: 'Nema registriranih strojeva.',
      noMachinesLink: 'Dodajte ih u Administraciji → Strojevi',
      coachMove: 'Povucite prvu operaciju za pomak cijelog naloga.',
      coachLane: 'Povucite operaciju okomito za promjenu stroja.',
      coachResize: 'Povucite rub kartice za promjenu sati.',
      coachDismiss: 'Razumijem',
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
      missingStartDateTime: 'Unesite početak izvođenja.',
      createdOrders: 'Kreirani nalozi',
      noCreatedOrders: 'Još nema kreiranih naloga.',
      print: 'Ispis',
      printTitle: 'RADNI NALOG',
      closePreview: 'Zatvori pregled',
      opNumber: 'R.br.',
      parentOrder: 'Nadređeni radni nalog',
      noParent: '(bez nadređenog - glavni nalog)',
      edit: 'Uredi',
      editingOrder: 'Uređujete nalog',
      saveChanges: 'Spremi izmjene',
      cancelEdit: 'Odustani od uređivanja',
      updated: 'Radni nalog je ažuriran. Izmjene su vidljive u svim prikazima.',
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
    appShell: {
      workstationOffline: 'Workstation is offline',
      changesStoredLocallyWill: 'Changes are stored locally and will sync when the connection returns.',
      changesWaitingSync: 'Changes waiting to sync',
      dueTimeHasPassed: 'The due time has passed or the order is marked delayed.',
      materialAvailabilityRisk: 'Material availability risk',
      machineScheduleOverlap: 'Machine schedule overlap',
      atLeastTwoOrders: 'At least two orders use the same machine during overlapping time.',
      capacityThresholdReached: 'Capacity threshold reached',
      todaySAbsence: 'Today’s absence',
      operationsStable: 'Operations are stable',
      noActiveDelaysConflicts: 'No active delays, conflicts, or synchronization issues.',
      navigation: 'Navigation',
      quickActions: 'Quick actions',
      openModule: 'Open module',
      newWorkOrder: 'New work order',
      startOrderCreationPrinting: 'Start order creation and printing',
      planShifts: 'Plan shifts',
      generatePublishSchedule: 'Generate and publish a schedule',
      workstationSettings: 'Workstation settings',
      appearanceSecurityPlanning: 'Appearance, security, and planning',
      lockNow: 'Lock now',
      secureCurrentWorkstation: 'Secure the current workstation',
      keepConnected: 'Keep connected',
      yourRoleCannotAccess: 'Your role cannot access this module.',
      mainNavigation: 'Main navigation',
      openMenu: 'Open menu',
      commandPaletteCtrlK: 'Command palette (Ctrl+K)',
      search: 'Search',
      online: 'Online',
      offline: 'Offline',
      text: '',
    },
    shiftPlanner: {
      noActiveShiftDefinitions: 'No active shift definitions — add them in the shift settings.',
      noWorkersDatabaseAdd: 'No workers in the database — add workers via Admin before generating.',
      scheduleGenerationFailed: 'Schedule generation failed.',
      pdfExportFailed: 'PDF export failed.',
      capacityPlanning: 'Capacity planning',
      interactiveShiftRotationWith: 'Interactive shift rotation with rest, absence, and weekly-hours validation.',
      synced: 'Synced',
      planner: 'Planner',
      publishedSchedules: 'Published schedules',
      publishedScheduleArchive: 'Published schedule archive',
      everyPublishSavesPermanent: 'Every publish saves a permanent snapshot — exactly what was issued and printed. Snapshots are never altered; editing a week creates a new version.',
      noPublishedSchedulesYet: 'No published schedules yet. Publish a week in the planner and it will show up here.',
      week: 'week',
      hideVersions: 'Hide versions',
      versionsShowAll: 'versions — show all',
      singleVersion: '1 version',
      current: 'current',
      assignments: 'assignments',
      view: 'View',
      editPlanner: 'Edit in planner',
      planStartMonday: 'Plan start (Monday)',
      weeks: 'Weeks',
      department: 'Department',
      generating: 'Generating…',
      generate: 'Generate',
      saveDraft: 'Save draft',
      buildingPdf: 'Building PDF…',
      showWeekendSatSun: 'Show weekend (Sat/Sun)',
      weekendsNotAutoFilled: 'Weekends are not auto-filled — assign them by hand.',
      scheduleSaved: 'Schedule saved.',
      activeWorkers: 'Active workers',
      absences: 'Absences',
      selectWorker: 'Select worker',
      add: 'Add',
      showHours: 'Show hours',
      hideEmpty: 'Hide empty',
      published: 'published',
      unpublished: 'unpublished',
      draft: 'draft',
      changedSincePublishRe: 'Changed since publish — re-publish for a new version',
      modified: 'modified',
      edit: 'Edit',
      publish: 'Publish',
      publishedScheduleLockedEdit: 'This published schedule is locked. “Edit” returns it to draft until you publish it again — the published version stays permanently in the archive.',
      restWeeklyHoursConflict: 'Rest or weekly-hours conflict',
      restPeriodWarning: ' · Rest period warning',
      warningWorkerHasRecorded: ' · Warning: worker has a recorded absence',
      overrides: 'overrides',
      weekDetailDayLevel: 'Week detail — day-level editing. Drag a worker to another cell for a manual override. Double-click for quick reassignment. Click the week number again to close.',
      publishedSnapshotReadOnly: 'Published snapshot — read only',
      publishedBy: 'published by',
      close: 'Close',
    },
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
      locale: 'en-US',
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
      typeSaw: 'Saw',
      typeQc: 'Quality control',
      typeOther: 'Other',
      axisShort: 'axis',
    },
    machineBoard: {
      zoomHour: 'Hour',
      zoomShift: 'Shift',
      zoomDay: 'Day',
      zoomWeek: 'Week',
      sortByName: 'Name',
      sortByLoad: 'Load',
      connectMode: 'Connect mode',
      connectModeHint: 'Tap a source order, then a target order to create a dependency.',
      scrollToday: 'Today',
      emptyLane: 'No jobs on this machine.',
      undo: 'Undo',
      redo: 'Redo',
      conflicts: 'Warnings',
      deleteConnection: 'Remove link',
      cycleBlocked: 'This link would create a dependency cycle.',
      dropInvalidSelf: 'A job cannot link to itself.',
      dropInvalidDuplicate: 'This link already exists.',
      dragHint: 'Drag a card to reschedule or reassign it. Drag from a card edge to link two orders.',
      sequentialRouteHint: 'This step is part of a sequential route — drag the first step to move the order, or edit it in the Gantt.',
      chainSegmentHint: 'Legacy machine chain — edit this order in the Work Order Creator to change its machines.',
      filterAll: 'All',
      autoSchedule: 'Auto-schedule',
      exportCsv: 'Export CSV',
      exportPng: 'Export PNG',
      jumpToConflict: 'Jump to conflict',
      chainSelected: 'Chain selected',
      chainSelectedHint: 'Links the selected orders Finish-to-Start in start order.',
      savedViews: 'Saved views',
      viewNamePlaceholder: 'View name…',
      saveView: 'Save view',
      deleteView: 'Delete view',
      search: 'Search',
      searchPlaceholder: 'Order or operation…',
      conflictsTitle: 'Conflicts',
      noConflicts: 'No conflicts',
      shiftLater: 'Shift later',
      moveTo: 'Move to…',
      viewInGantt: 'View in Gantt',
      overlaps: 'overlaps',
      noFreeMachine: 'No free machine of the same type',
      orderGone: 'Order no longer on the board.',
      hideEmpty: 'Hide empty',
      collapseLane: 'Collapse/expand lane',
      more: 'More',
      legend: 'Legend',
      legendOperation: 'Route operation',
      legendChain: 'Legacy chain',
      legendConflict: 'Machine overlap',
      legendNow: 'Now',
      showOnBoard: 'Show on machine board',
      quickCreateTitle: 'Quick add',
      quickCreateDuration: 'Duration (h)',
      quickCreateCreate: 'Create',
      quickCreateMore: 'More options → Work Order Creator',
      addManually: 'Add manually',
      emptyBoard: 'Double-click any lane to schedule work here, or create a routed order in the Work Order Creator.',
      emptyBoardLink: 'Open Work Order Creator →',
      noMachinesTitle: 'No machines registered.',
      noMachinesLink: 'Add them in Admin → Machines',
      coachMove: 'Drag the first operation to move the whole order.',
      coachLane: 'Drag any operation vertically to change its machine.',
      coachResize: 'Drag a card edge to resize its hours.',
      coachDismiss: 'Got it',
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
      missingStartDateTime: 'Enter a start time.',
      createdOrders: 'Created orders',
      noCreatedOrders: 'No orders created yet.',
      print: 'Print',
      printTitle: 'WORK ORDER',
      closePreview: 'Close preview',
      opNumber: 'No.',
      parentOrder: 'Parent work order',
      noParent: '(no parent - top-level order)',
      edit: 'Edit',
      editingOrder: 'Editing order',
      saveChanges: 'Save changes',
      cancelEdit: 'Cancel editing',
      updated: 'Work order updated. The changes are visible in every view.',
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
