# p5-Studio-PRO — Manuale Utente & Documentazione Ufficiale

<div align="center">

![p5-Studio-PRO](https://raw.githubusercontent.com/muccio/p5-Studio-PRO/main/p5-studio-pro/templates/default-sketch/assets/logo.png)

**L'ambiente di sviluppo desktop professionale per Creative Coding con p5.js e GLSL Shaders.**  
*Audio-Reattivo • Ponte OSC Bidirezionale • Live Stage Multi-Monitor • Video Exporter 4K Deterministico*

[![Release](https://img.shields.io/github/v/release/muccio/p5-Studio-PRO?style=for-the-badge&color=00e5ff)](https://github.com/muccio/p5-Studio-PRO/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-7928ca?style=for-the-badge)](https://github.com/muccio/p5-Studio-PRO/releases)
[![Tests](https://img.shields.io/badge/Tests-15%2F15%20Passing-00f59b?style=for-the-badge)](test/verify.js)
[![License](https://img.shields.io/badge/License-MIT-ff0055?style=for-the-badge)](LICENSE)

</div>

---

## 📑 Indice dei Contenuti

1. [Panoramica](#-panoramica)
2. [Installazione e Download](#-installazione-e-download)
   - [macOS (Apple Silicon & Intel)](#macos-apple-silicon--intel)
   - [Risoluzione Avviso Gatekeeper su Mac](#-risoluzione-avviso-gatekeeper-su-mac)
   - [Windows (Installer & Portable)](#windows-installer--portable)
   - [Esecuzione da Codice Sorgente](#esecuzione-da-codice-sorgente)
3. [Guida all'Interfaccia Utente (GUI)](#-guida-allinterfaccia-utente-gui)
   - [Toolbar Superiore](#toolbar-superiore)
   - [File Tree ed Esplora Risorse](#file-tree-ed-esplora-risorse)
   - [Monaco Editor con IntelliSense](#monaco-editor-con-intellisense)
   - [Preview Sandbox & Pannelli Comprimibili](#preview-sandbox--pannelli-comprimibili)
   - [Barra di Stato](#barra-di-stato)
4. [Motore Audio-Reattivo DSP](#-motore-audio-reattivo-dsp)
   - [Ingressi Audio in Tempo Reale](#ingressi-audio-in-tempo-reale)
   - [Texture Audio WebGL (`u_audioTex`)](#texture-audio-webgl-u_audiotex)
   - [API JavaScript `window.ideAudio`](#api-javascript-windowideaudio)
5. [Ponte OSC (Open Sound Control)](#-ponte-osc-open-sound-control)
   - [Configurazione Porte RX/TX](#configurazione-porte-rxtx)
   - [Associazione Uniforms negli Shader](#associazione-uniforms-negli-shader)
   - [Registrazione e Riproduzione Takes](#registrazione-e-riproduzione-takes)
6. [Live Stage & Proiezione su Secondo Schermo](#-live-stage--proiezione-su-secondo-schermo)
7. [Esportazione Video 4K Frame-by-Frame](#-esportazione-video-4k-frame-by-frame)
   - [Sincronizzazione Deterministica Audio-Video](#sincronizzazione-deterministica-audio-video)
   - [Profili Codec e Risoluzioni](#profili-codec-e-risoluzioni)
8. [Personalizzazione Aspetto (Font & Trasparenza)](#-personalizzazione-aspetto-font--trasparenza)
9. [Scorciatoie da Tastiera (Hotkeys)](#-scorciatoie-da-tastiera-hotkeys)
10. [Risoluzione Problemi Frequenti (FAQ)](#-risoluzione-problemi-frequenti-faq)

---

## 🌟 Panoramica

**p5-Studio-PRO** è un ambiente integrato progettato su misura per artisti digitali, creative coder, VJ e designer visivi. Supera i limiti dei browser standard e dei web editor tradizionali offrendo:

- **Esecuzione Desktop Nativa:** Supporto completo per accelerazione WebGL a 60/120 FPS senza limiti di memoria del browser.
- **Supporto Modulare GLSL:** Direttive `#include "common.glsl"` ricorsive con mappatura precisa degli errori di compilazione direttamente sulle righe di Monaco Editor.
- **Audio DSP Engine a 32-bit:** Analisi FFT e oscilloscopio a bassissima latenza proiettate in una data-texture WebGL (`u_audioTex`) leggibile dagli shader a 60 FPS.
- **Integrazione OSC Universale:** Compatibilità plug-and-play con software musicali e hardware (Ableton Live, TouchDesigner, Max/MSP, pure data, controller MIDI/OSC).
- **Export Video Deterministico:** Rendering offline a 60 FPS fino a risoluzione 4K, con sincronizzazione perfetta dell'audio senza frame dropping o troncamento.

---

## 📦 Installazione e Download

Puoi scaricare l'ultima versione precompilata direttamente dalla sezione [GitHub Releases](https://github.com/muccio/p5-Studio-PRO/releases/latest).

### macOS (Apple Silicon & Intel)
- **Apple Silicon (M1/M2/M3/M4):** scarica `p5-Studio-PRO-1.2.2-arm64.dmg`.
- **Apple Intel (x86_64):** scarica `p5-Studio-PRO-1.2.2-x64.dmg`.

Apri il file `.dmg` scaricato e trascina l'icona di **p5-Studio-PRO** nella cartella **Applicazioni**.

#### 🛡️ Risoluzione Avviso Gatekeeper su Mac
Se al primo avvio macOS mostra il messaggio:
> *"Apple non è in grado di verificare che p5-Studio-PRO.app non contenga malware..."*

Questo avviso è normale per i progetti open-source non distribuiti tramite Mac App Store. Puoi aprirlo facilmente con **uno dei due metodi**:

1. **Metodo dal Finder (Consigliato):**
   - Apri la cartella **Applicazioni**.
   - Fai **clic destro** (oppure tieni premuto <kbd>Control</kbd> e clicca con il tasto sinistro) sull'icona di **p5-Studio-PRO**.
   - Seleziona **Apri** dal menu a tendina.
   - Nella finestra di avviso comparirà il pulsante **"Apri"**: cliccalo. Dal prossimo avvio, l'app si aprirà con un normale doppio clic!
   - *(Su macOS Ventura, Sonoma e Sequoia puoi anche andare in: Impostazioni di Sistema → Privacy e Sicurezza → scorri su Sicurezza → clicca su "Apri comunque").*

2. **Metodo da Terminale (Immediato):**
   Apri il Terminale ed esegui il seguente comando per rimuovere il blocco di quarantena:
   ```bash
   xattr -cr /Applications/p5-Studio-PRO.app
   ```

---

### Windows (Installer & Portable)
- **Installer Windows (.exe):** scarica `p5-Studio-PRO Setup 1.2.2.exe`. Esegui l'installer guidato con installazione automatica e icona sul desktop.
- **Versione Portable (.exe):** scarica `p5-Studio-PRO 1.2.2.exe`. Non richiede installazione, puoi eseguirlo direttamente anche da chiavetta USB.

---

### Esecuzione da Codice Sorgente

Se desideri clonare e compilare il progetto autonomamente:

```bash
# 1. Clona il repository
git clone https://github.com/muccio/p5-Studio-PRO.git
cd p5-Studio-PRO

# 2. Installa le dipendenze
npm install

# 3. Avvia in modalità sviluppo con live hot-reload
npm run dev

# 4. Compila i pacchetti di rilascio
npm run dist:mac       # Genera DMG per macOS Apple Silicon
npm run dist:mac:x64   # Genera DMG per macOS Intel
npm run dist:win       # Genera Setup ed Exe per Windows 64-bit
```

---

## 🖥️ Guida all'Interfaccia Utente (GUI)

L'interfaccia di **p5-Studio-PRO** è suddivisa in aree funzionali studiate per massimizzare il flusso di lavoro creativo:

```
┌────────────────────────────────────────────────────────────────────────┐
│  TOOLBAR (File, Preview Controls, p5 Versions, Libraries, Video, Font) │
├──────────────┬────────────────────────────┬────────────────────────────┤
│              │                            │  PREVIEW SANDBOX           │
│  FILE TREE   │  MONACO CODE EDITOR        │  (WebGL / 2D Canvas)       │
│  (Progetto)  │  (Syntax, IntelliSense,    ├────────────────────────────┤
│              │   GLSL #include, Errors)   │  AUDIO DSP ENGINE (Collap) │
│              │                            ├────────────────────────────┤
│              │                            │  OSC MONITOR (Collap)      │
├──────────────┴────────────────────────────┴────────────────────────────┤
│  STATUS BAR (Versione p5, Info Progetto, Zoom Font, Trasparenza)       │
└────────────────────────────────────────────────────────────────────────┘
```

### Toolbar Superiore
La barra superiore è organizzata su due livelli compatti per garantire l'accesso immediato a tutti gli strumenti:
- **Open Project / New File / New Folder:** Gestione cartelle e file del progetto p5.js.
- **Restart (↺):** Ricarica istantaneamente l'anteprima dello sketch azzerando stato e cronometri.
- **Live Stage:** Apre la finestra indipendente borderless per la proiezione live a tutto schermo.
- **Popout:** Separa l'anteprima sandbox in una finestra mobile, ideale se utilizzi due monitor per scrivere codice su uno e vedere l'anteprima sull'altro.
- **p5.js Version Selector:** Selettore dinamico per alternare al volo la versione del runtime p5.js:
  - `p5.js v1.9.0` (Stabile)
  - `p5.js v1.11.2` (Raccomandata)
  - `p5.js v2.0.0-beta` (Nuova generazione con WebGPU e architettura modulare)
- **Librerie (Catalog):** Apre il catalogo delle librerie p5.js ufficiali e della community (p5.sound, p5.gui, ml5.js, dat.gui, toxiclibs, p5.grain, ecc.) con inserimento automatico in un click.
- **p5 Reference (?):** Finestra modale con ricerca interattiva di tutte le funzioni, sintassi ed esempi ufficiali di p5.js.
- **Export Video:** Finestra di esportazione video deterministica con profili di codifica FFmpeg.
- **Appearance (⚙):** Gestione estetica dell'IDE (dimensione font, font family e trasparenza finestra).

### File Tree ed Esplora Risorse
- Visualizza la struttura completa dei file (`sketch.js`, `effect.vert`, `effect.frag`, `common.glsl`, immagini, audio, video).
- Facendo clic con il tasto destro è possibile creare nuovi file, rinominare, eliminare o caricare asset.

### Monaco Editor con IntelliSense
- Il motore editoriale di Visual Studio Code integrato nell'app.
- **Completamento automatico:** Suggerimenti intelligenti per tutte le funzioni native di p5.js (`createCanvas`, `rect`, `push`, `pop`, `shader`, ecc.).
- **Syntax Guard:** Rilevamento in tempo reale di errori di sintassi prima dell'esecuzione per evitare blocchi dello sketch.
- **Documentazione contestuale:** Passando il mouse sopra una funzione p5.js o facendo clic destro viene visualizzata la documentazione con link diretto.

### Preview Sandbox & Pannelli Comprimibili
- **Espansione flessibile:** Cliccando sull'intestazione delle sezioni **AUDIO-REACTIVE DSP ENGINE** oppure **OSC MONITOR & UNIFORMS**, i rispettivi pannelli si riducono a una striscia sottile, consentendo alla **Preview Sandbox** di espandersi automaticamente verso il basso sfruttando l'intera altezza della finestra.
- Lo stato di apertura o chiusura dei pannelli viene salvato automaticamente e conservato ai successivi avvii.

---

## 🔊 Motore Audio-Reattivo DSP

p5-Studio-PRO include un motore DSP a 32-bit float operante a 48 kHz.

### Ingressi Audio in Tempo Reale
- Nel menu a tendina dell'Audio Engine puoi selezionare qualsiasi periferica collegata:
  - Microfoni fisici.
  - Schede audio e interfacce USB/Thunderbolt.
  - Driver virtuali per catturare l'audio di sistema o DAW (come **BlackHole** o **Loopback** su Mac, **VB-Cable** su Windows).
- I visualizzatori mostrano in tempo reale:
  - **Spettro FFT** (frequenze da 20 Hz a 20 kHz).
  - **Oscilloscopio Waveform** (forma d'onda nel dominio del tempo).
  - **Misuratori di banda dedicati:** Sub (20-60 Hz), Bass (60-250 Hz), Low-Mid (250-500 Hz), Mid (500-2000 Hz), High-Mid (2000-4000 Hz), Treble (4000-20000 Hz).
  - Indicatore di ampiezza **RMS**.

### Texture Audio WebGL (`u_audioTex`)
Negli shader GLSL è disponibile una data-texture dinamica $1024 \times 2$ pixel a 32-bit aggiornata ad ogni fotogramma:
- **Riga 0 ($y = 0.25$):** 1024 bin normalizzati dello spettro di frequenza FFT (canale rosso `r`).
- **Riga 1 ($y = 0.75$):** 1024 campioni della forma d'onda (canale rosso `r`, con $0.5$ corrispondente al silenzio).

Esempio di lettura nello shader fragment (`effect.frag`):
```glsl
precision highp float;
uniform sampler2D u_audioTex;
varying vec2 vTexCoord;

void main() {
    // Campiona la frequenza corrispondente alla coordinata X
    float bass = texture2D(u_audioTex, vec2(0.05, 0.25)).r;
    
    // Campiona la forma d'onda
    float wave = (texture2D(u_audioTex, vec2(vTexCoord.x, 0.75)).r - 0.5) * 2.0;

    gl_FragColor = vec4(bass, 0.3, wave, 1.0);
}
```

### API JavaScript `window.ideAudio`
Negli sketch p5.js è possibile accedere ai dati audio tramite l'oggetto globale `ideAudio`:
```javascript
function draw() {
    background(0);
    
    // Livello medio volume (0.0 - 1.0)
    let volume = ideAudio.getRMS();
    
    // Livello di una specifica banda: 'sub', 'bass', 'lowmid', 'mid', 'highmid', 'treble'
    let bassEnergy = ideAudio.getEnergy('bass');
    
    // Rilevamento automatico battuta (kick / beat)
    if (ideAudio.isBeat()) {
        fill(255, 0, 80);
    } else {
        fill(100);
    }
    
    circle(width / 2, height / 2, 50 + bassEnergy * 200);
}
```

---

## 📡 Ponte OSC (Open Sound Control)

Il modulo OSC permette la comunicazione bidirezionale a bassissima latenza con software esterni come Ableton Live, TouchDesigner, Max/MSP o controller su iPad/tablet (es. TouchOSC).

### Configurazione Porte RX/TX
- **Porta Ricezione (RX):** `9000` (predefinita).
- **Porta Trasmissione (TX):** `9001` (predefinita).
- L'indicatore nella GUI mostra il numero di messaggi al secondo (msg/s) e visualizza un log in tempo reale con indirizzo e valori ricevuti.

### Associazione Uniforms negli Shader
Puoi associare automaticamente un messaggio OSC a una variabile uniform del tuo shader senza dover scrivere codice manuale:
```javascript
window.ideOSC.bindUniforms(myShader, {
    u_zoom: ['/shader/zoom', 1.0],      // Se riceve /shader/zoom f, aggiorna u_zoom
    u_color: ['/shader/color', 0.5],
    u_speed: ['/shader/speed', 1.2]
});
```

### Registrazione e Riproduzione Takes
Durante una sessione live o un'improvvisazione, premendo **Record Take**, p5-Studio-PRO registra sia l'audio lossless Float32 che tutti i messaggi OSC con timestamp millisecondo per millisecondo in un file `take_osc.json`. Durante l'esportazione video, l'intera sessione registrata viene rieseguita in modo deterministico frame per frame!

---

## 🎬 Live Stage & Proiezione su Secondo Schermo

Premendo il pulsante **Live Stage** nella toolbar (oppure con la combinazione rapida <kbd>Cmd</kbd> + <kbd>Enter</kbd> su Mac o <kbd>Ctrl</kbd> + <kbd>Enter</kbd> su Windows):

1. Si apre una finestra indipendente borderless a schermo intero.
2. Puoi trascinarla su un secondo monitor o videoproiettore.
3. Continuando a modificare il codice sull'editor del tuo computer principale, ogni salvataggio o push aggiornerà istantaneamente lo stage live senza azzerare l'animazione e senza interruzioni visive.

---

## 🎞️ Esportazione Video 4K Frame-by-Frame

La finestra di esportazione video permette di convertire gli sketch in file video di altissima qualità senza i cali di framerate tipici delle registrazioni a schermo.

### Sincronizzazione Deterministica Audio-Video
- Il rendering viene eseguito in modalità **lockstep non-real-time**: il tempo virtuale avanza esattamente di $1 / \text{fps}$ a ogni fotogramma. Anche per gli sketch più pesanti e complessi, il video finale sarà sempre fluido a 60 FPS senza perdere neppure un fotogramma.
- Selezionando una traccia audio (file `.wav` o `.mp3`), l'esportatore campiona l'audio esattamente in corrispondenza del tempo di ogni frame:
  - Le funzioni di `p5.sound` (`p5.FFT`, `p5.Amplitude`, `SoundFile`) vengono sincronizzate offline.
  - La durata del video viene impostata automaticamente sulla durata esatta del brano audio.
  - Il file video finale ha l'audio perfettamente allineato e codificato in AAC ad alta fedeltà a 320 kbps.

### Profili Codec e Risoluzioni
- **H.264 Master (YUV420p):** Ideale per YouTube, Instagram, web e riproduzione su qualsiasi dispositivo (CRF 15, massima qualità).
- **H.264 Chroma-Pure (YUV444p):** Nessun sottocampionamento del colore, ideale per grafica generativa e shader con linee sottili e testi vettoriali.
- **Apple ProRes 4444 (con canale Alpha):** Supporta video con sfondo trasparente per compositing professionale in DaVinci Resolve, Final Cut Pro o Adobe Premiere.

Risoluzioni supportate:
- 1080p Full HD ($1920 \times 1080$)
- 4K Ultra HD ($3840 \times 2160$)
- 1:1 Quadrato ($1080 \times 1080$) per feed social
- 9:16 Verticale ($1080 \times 1920$) per Reel / TikTok / Shorts

---

## 🎨 Personalizzazione Aspetto (Font & Trasparenza)

Cliccando sull'icona delle impostazioni aspetto (⚙) nella toolbar superiore o nella barra di stato in basso, puoi personalizzare l'editor:

- **Dimensione Font (Font Size):** Regolabile da 9px a 32px tramite slider o pulsanti +/-.
- **Tipo di Carattere (Font Family):** Scegli tra font ottimizzati per la programmazione con legature tipografiche:
  - *JetBrains Mono*
  - *Fira Code*
  - *Cascadia Code*
  - *Consolas / Menlo*
  - Oppure digita il nome di qualsiasi font installato sul tuo sistema operativo.
- **Trasparenza Finestra (Window Opacity):** Regola l'opacità complessiva dell'IDE dal 30% al 100% per vedere il desktop o finestre di documentazione/tutorial sottostanti mentre scrivi codice.

---

## ⌨️ Scorciatoie da Tastiera (Hotkeys)

| Scorciatoia (macOS) | Scorciatoia (Windows) | Funzione |
| :--- | :--- | :--- |
| <kbd>Cmd</kbd> + <kbd>S</kbd> | <kbd>Ctrl</kbd> + <kbd>S</kbd> | Salva il file ed esegue l'hot-swap dello sketch |
| <kbd>Cmd</kbd> + <kbd>Enter</kbd> | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Invia istantaneamente il codice allo stage Live |
| <kbd>Cmd</kbd> + <kbd>+</kbd> | <kbd>Ctrl</kbd> + <kbd>+</kbd> | Ingrandisce il font dell'editor |
| <kbd>Cmd</kbd> + <kbd>-</kbd> | <kbd>Ctrl</kbd> + <kbd>-</kbd> | Rimpicciolisce il font dell'editor |
| <kbd>Tasto destro</kbd> su codice | <kbd>Tasto destro</kbd> su codice | Cerca la funzione selezionata nella p5.js Reference |
| <kbd>Esc</kbd> | <kbd>Esc</kbd> | Chiude le finestre modali attive (Reference, Librerie, Aspetto) |

---

## ❓ Risoluzione Problemi Frequenti (FAQ)

### 1. Su macOS l'app dice che non può essere verificata da Apple
Segui la guida al paragrafo [Risoluzione Avviso Gatekeeper su Mac](#-risoluzione-avviso-gatekeeper-su-mac): fai clic destro sull'app nella cartella Applicazioni e scegli **Apri**, oppure esegui nel Terminale `xattr -cr /Applications/p5-Studio-PRO.app`.

### 2. L'audio non risponde o il microfono non acquisisce
- Verifica che macOS abbia concesso l'autorizzazione all'uso del microfono per p5-Studio-PRO (*Impostazioni di Sistema → Privacy e Sicurezza → Microfono*).
- Nel pannello **Audio-Reactive DSP Engine**, assicurati che il menu a tendina selezioni l'ingresso corretto e non una periferica mutata.

### 3. Lo shader mostra una schermata nera
- p5-Studio-PRO protegge la visualizzazione: se c'è un errore di sintassi, nella parte inferiore dell'editor compare una riga rossa con il numero di riga esatto dell'errore.
- Assicurati che il fragment shader includa la dichiarazione di precisione `precision highp float;` (p5-Studio-PRO la inietta comunque automaticamente se omessa).

### 4. Il video esportato non ha l'audio sincronizzato
- Assicurati di aver selezionato il file audio corretto nel campo **Audio Track (Optional)** della finestra di export.
- Il file audio verrà decodificato automaticamente e allineato ai frame del video senza disallineamenti di sync.

---

## 📄 Licenza

Questo progetto è rilasciato sotto licenza open-source **MIT**.  
Creato con passione da [Mario Salvucci (muccio)](https://github.com/muccio). Contributi, segnalazioni di bug e suggerimenti sono i benvenuti!
