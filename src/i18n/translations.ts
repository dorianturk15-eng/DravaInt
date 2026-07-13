export type Lang = 'hr' | 'en';

export interface TranslationShape {
  appTitle: string;
  nav: {
    shifts: string;
    machines: string;
    progress: string;
    gantt: string;
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
    step1: string;
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
    logoMissing: string;
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
  };
  progress: {
    title: string;
    subtitle: string;
    task: string;
    addTask: string;
    statusOptions: {
      planned: string;
      inProgress: string;
      done: string;
      delayed: string;
    };
  };
  gantt: {
    title: string;
    subtitle: string;
    today: string;
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
}

export const translations: Record<Lang, TranslationShape> = {
  hr: {
    appTitle: 'Drava International - Planer',
    nav: {
      shifts: 'Raspored smjena',
      machines: 'Raspored strojeva',
      progress: 'Praćenje napretka',
      gantt: 'Gantogram',
    },
    common: {
      calculate: '🔄 1. Izračunaj i ažuriraj',
      print: '🖨️ 2. Isprintaj / PDF',
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
      step1: 'Učitajte logotip tvrtke',
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
      logoMissing: 'Logotip nije učitan (korak 1)',
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
    },
    progress: {
      title: 'Praćenje napretka',
      subtitle: 'Pregled statusa svih aktivnih zadataka i naloga.',
      task: 'Zadatak',
      addTask: 'Dodaj zadatak',
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
  },
  en: {
    appTitle: 'Drava International - Planner',
    nav: {
      shifts: 'Shift Schedule',
      machines: 'Machine Scheduling',
      progress: 'Progress Monitoring',
      gantt: 'Gantt Chart',
    },
    common: {
      calculate: '🔄 1. Calculate and update',
      print: '🖨️ 2. Print / PDF',
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
      step1: 'Upload company logo',
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
      logoMissing: 'Logo not uploaded (step 1)',
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
    },
    progress: {
      title: 'Progress Monitoring',
      subtitle: 'Overview of the status of all active tasks and orders.',
      task: 'Task',
      addTask: 'Add task',
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
  },
};
