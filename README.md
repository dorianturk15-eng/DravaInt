# Drava International – Planer

Web aplikacija za planiranje proizvodnje: raspored smjena, raspored strojeva, praćenje napretka i gantogram.

Application for production planning: shift scheduling, machine scheduling, progress monitoring, and a Gantt chart.

Zadani jezik je hrvatski, s mogućnošću prebacivanja na engleski (gornji desni kut). / Default language is Croatian, with English available as an option (top-right corner).

## Pokretanje / Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Značajke / Features

- **Raspored smjena / Shift Schedule** – čarobnjak za generiranje tjednog rasporeda smjena s ispisom u A4 formatu (logotip, popisi radnika, rotacija smjena).
- **Raspored strojeva / Machine Scheduling** – planiranje zauzetosti strojeva po radnim nalozima, operaterima i vremenskim terminima.
- **Praćenje napretka / Progress Monitoring** – pregled statusa zadataka (planirano, u tijeku, završeno, kašnjenje) s postotkom napretka.
- **Gantogram / Gantt Chart** – vremenski prikaz svih zadataka s linijom "danas".
