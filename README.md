Parfait 👍 — voici la **version complète et finale** du **README.md** pour ton projet `vbmatrix-tool`, entièrement mise à jour pour correspondre à ton `.env.example` et à la structure réelle du projet (backend Node.js, API Express, VBAN-TEXT, frontend pur HTML/JS/Tailwind).

# vbmatrix-tool

**Outil Node.js pour piloter, visualiser et automatiser une matrice audio VBAN (Voicemeeter Matrix / Banana / Potato)**
Envoyez des commandes VBAN-TEXT, contrôlez les gains, mutez, réinitialisez et affichez vos connexions dans une interface web claire et responsive.

## ✨ Fonctionnalités

* **Découverte automatique** des slots audio (`WIN1..4`, `VBAN1..4`, `VAIO1..4`, etc.)
* Lecture complète du **routing** (Input ➜ Output)
* Contrôle total des points :

  * Activation / désactivation (gain `-99 dB`)
  * Réglage de **gain** précis (-80 à +6 dB)
  * **Mute / Unmute**
  * **Reset** d’un lien
* Détection automatique :

  * Moyenne automatique des gains stéréo
  * Points inactifs (`-inf`)
* API REST simple pour intégration dans **Home Assistant**, **Node-RED**, **n8n**, etc.
* Interface web **sans framework** : HTML + Tailwind + JavaScript pur
* Rafraîchissement sélectif : ne recharge que le lien modifié
* Effet visuel fluide lors de l’activation d’un point

## 📦 Prérequis

* **Voicemeeter VBAN Matrix** (ou **Voicemeeter Banana/Potato**) avec **VBAN-TEXT activé**
* Machine sur le **même réseau local** que le serveur VBAN
* **Node.js 18+**
* Accès au port **UDP 6980** (VBAN-TEXT)
* Les canaux audio doivent être nommés de façon unique pour une identification correcte avec en suffixe le côté (ex: `PC-01 (L)`, `PC-01 (R)`)

## 🔧 Installation

```bash
git clone https://github.com/jul-fls/vbmatrix-tool.git
cd vbmatrix-tool
npm install
```

### Configuration `.env`

Exemple de fichier :

```ini
# Adresse IP du serveur VBAN Matrix
VBAN_HOST=192.168.1.237

# Nom du flux VBAN-TEXT utilisé pour envoyer les commandes
VBAN_COMMAND_STREAM_NAME=Command1

# Port UDP d’écoute du VBAN Matrix (par défaut : 6980)
VBAN_PORT=6980

# Port HTTP pour le serveur Express (interface + API)
HTTP_PORT=3000
```

## ▶️ Démarrage

```bash
npm start
# ou
node app.js
```

L’application démarre sur :

* 🌐 **Interface web** → [http://localhost:3000](http://localhost:3000)
* 🔌 **API REST** → [http://localhost:3000/api](http://localhost:3000/api)

## 🔌 API REST

Base URL : `http://<host>:<port>/api`

### 1) Liste des slots et entrées/sorties

`GET /matrix`

Renvoie la topologie complète (WIN, VBAN, VAIO…) avec les entrées/sorties détectées.

### 2) État complet de la matrice

`GET /connections`

Renvoie tous les points **Input ➜ Output** avec leur état :

```json
{
  "WIN1 → WIN2": {
    "Alexa → Casque 1": {
      "connected": false,
      "gain": null,
      "mute": false
    }
  }
}
```

### 3) État d’un lien spécifique

`GET /connections/:src/:dst`

Exemple :

```
GET /api/connections/VBAN1/WIN4
```

```json
{
  "PC-01 → Enceintes bureau": {
    "connected": true,
    "gain": -9,
    "gains": [-10, -8],
    "mute": false
  }
}
```

### 4) Rafraîchir la matrice complète

`POST /refresh`

> Re-synchronise toutes les données avec le serveur VBAN.

---

### 5) Contrôler un point

`POST /action`

Body :

```json
{
  "source": "PC-01",
  "target": "Enceintes bureau",
  "action": "gain",
  "value": -20
}
```

Actions possibles :

| Action    | Description              | Exemple         |
| --------- | ------------------------ | --------------- |
| `"gain"`  | Définit le gain (en dB)  | `"value": -20`  |
| `"mute"`  | Active/désactive le mute | `"value": true` |
| `"reset"` | Réinitialise la liaison  | —               |

### 6) Lecture directe (sans cache)

`GET /live/:src/:dst?inName=<input>&outName=<output>`

Exemple :

```
GET /api/live/VBAN1/WIN4?inName=PC-01&outName=Enceintes%20bureau
```

> Interroge le serveur VBAN instantanément (bypass du cache local).

## 🖥️ Interface Web

L’interface moderne et responsive affiche toutes les connexions sous forme de grille :

* **Zone grisée** → non connecté (cliquez pour activer, gain = -99 dB)
* **Zone verte** → connectée
* **Slider** → ajuste le gain en temps réel
* **🔊 / 🔇** → mute / unmute instantané
* **♻️** → reset du lien

Exemple visuel :

```
[ PC-01 → Enceintes bureau ]   Gain: -9 dB   [🔊][───────🔘──────][♻️]
```

L’interface s’adapte automatiquement à votre écran, sans scroll horizontal ni vertical.

## 🧠 Détails techniques

* **Stack** : Node.js + Express + UDP (VBAN-TEXT)
* **Frontend** : HTML + TailwindCSS (CDN) + JavaScript pur
* **Communication VBAN** :

  * Commandes `Point(...).dBGain = ?`, `Mute = ?`, `Reset;`
  * Parsing des réponses (`-inf`, stéréo, moyenne des canaux)
* **Cache local** pour accélérer l’affichage
* **Rafraîchissement minimal** via `/live/...` après chaque action
* **Animations CSS** : transition douce lors de l’activation d’un lien

## 🧪 Exemples cURL

```bash
# Lire toute la matrice
curl http://localhost:3000/api/connections

# Lire un lien précis
curl http://localhost:3000/api/connections/VBAN1/WIN4

# Régler le gain
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"source":"PC-01","target":"Enceintes bureau","action":"gain","value":-10}'

# Mute
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"source":"PC-01","target":"Enceintes bureau","action":"mute","value":true}'

# Reset
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"source":"PC-01","target":"Enceintes bureau","action":"reset"}'
```

## 🧱 Structure du projet

```
vbmatrix-tool/
├── helpers.js               # Logique VBAN-TEXT (création paquets, parsing réponses)
├── web/
│   ├── front/
│   │   ├── index.html       # Interface web principale
│   │   ├── script.js        # Logique JS (gain, mute, reset, live refresh)
│   └── api/
│       ├── server.js        # Point d'entrée de l'API
├── .env.example             # Exemple de configuration
├── Dockerfile               # Fichier Docker pour conteneuriser l'application
├── package.json
└── README.md
```

## 🐳 Exécution via Docker

```bash
docker build -t vbmatrix-tool .
docker run --rm -p 3000:3000 \
  -e VBAN_HOST=192.168.1.237 \
  -e VBAN_COMMAND_STREAM_NAME=Command1 \
  -e VBAN_PORT=6980 \
  -e HTTP_PORT=3000 \
  --name vbmatrix vbmatrix-tool
```

> Assurez-vous que le conteneur peut joindre le serveur VBAN sur le port UDP 6980 (ou celui configuré).

## 🛠️ Dépannage

* **Aucune donnée détectée**
  Vérifiez que **VBAN-TEXT est activé** dans Voicemeeter Matrix et que le flux `Command1` (ou un autre flux configuré) est bien configuré.

* **Pas de réponse UDP**
  Vérifiez les pare-feux Windows ; le port 6980 doit être accessible en UDP.

* **Latence élevée**
  Le scan complet de la matrice interroge tous les points ; utilisez `/live/...` pour des rafraîchissements ciblés.

## 🧭 Roadmap

* Vue “table” interactive (édition directe)
* Undo / redo
* Authentification API simple
* WebSocket pour mise à jour temps réel
* Export / import de presets
* Intégration Home Assistant auto-discovery

## 💡 Auteur

Projet développé par **Julien Flusin (Julfls)**
📧 [julien@flusin.fr](mailto:julien@flusin.fr)
💻 [github.com/jul-fls](https://github.com/jul-fls)