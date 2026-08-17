# pi-keep-going

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **Français** · [Español](README.es.md)

Une extension [Pi](https://pi.dev) qui maintient une exécution en vie malgré les
limites d'usage des fournisseurs, et qui planifie à la demande des messages de
relance ponctuels.

## Aucune configuration — ça tourne tout seul

**Vous n'avez aucune commande à lancer.** La reprise automatique est active par
défaut (`autoResume.enabled: true`) : dès l'installation, l'extension surveille
chaque tour d'elle-même.

1. Elle met en cache toute réponse `429` reçue du fournisseur.
2. Quand un tour se termine sur une erreur de limite d'usage, elle classifie
   l'erreur et résout l'heure de réinitialisation (en-têtes → corps de l'erreur →
   API d'usage du fournisseur).
3. Elle planifie le message de continuation (`continue`) à
   `réinitialisation + 90 s` et vous indique l'heure :
   `Usage limit reached (anthropic) — auto-resuming at 14:05.`

Dès que la fenêtre rouvre, le message part et l'agent reprend là où il s'était
arrêté. La commande `/kg` sert aux cas où vous voulez planifier vous-même — elle
n'est jamais nécessaire pour le chemin automatique.

## Installation

```bash
pi install git:github.com/ohlulu/pi-keep-going
```

Pas encore publié sur npm. Pour contribuer, installez plutôt le clone par chemin
local : une installation par chemin est référencée depuis
`~/.pi/agent/settings.json`, pas copiée, donc vos modifications prennent effet au
prochain démarrage de Pi.

```bash
git clone https://github.com/ohlulu/pi-keep-going
pi install ./pi-keep-going
```

## Commande `/kg`

| Commande | Effet |
| --- | --- |
| `/kg 40m keep going` | Envoie `keep going` dans 40 minutes. |
| `/kg 2h30m` | Envoie le message par défaut (`keep going`) dans 2 h 30. |
| `/kg 90s ship it` | La durée va de la plus grande unité à la plus petite : `d h m s`, chaque unité au plus une fois. |
| `/kg auto [message]` | Interroge l'API d'usage du fournisseur courant et planifie à l'heure de réinitialisation + marge. |
| `/kg list` | Liste les messages planifiés en attente. |
| `/kg cancel` | Annule un message planifié (demande lequel s'il y en a plusieurs). |

Les tâches planifiées sont persistées par branche : elles survivent à `/tree`, à
`/fork` et à un rechargement. Les minuteries reposent sur un horodatage de
déclenchement absolu vérifié toutes les 30 s, donc une tâche se déclenche
correctement même après une mise en veille de la machine. Rien n'entre dans le
contexte du LLM, hormis le message final réellement envoyé.

## Reprise automatique

Quand un tour se termine sur une erreur de limite d'usage, l'extension :

1. Classifie l'erreur par fournisseur (à partir du message d'erreur de
   l'assistant et des en-têtes de réponse `429` mis en cache).
2. Résout l'heure de réinitialisation (en-têtes → heure intégrée au message →
   API d'usage du fournisseur). Cette étape via l'API d'usage est déterminante
   pour Anthropic : le SDK lève une exception sur un 429 avant que pi puisse
   observer la réponse, si bien que les en-têtes unified-reset ne sont jamais
   mis en cache et que le corps de l'erreur ne porte aucune heure de
   réinitialisation.
3. Planifie un message de continuation à `réinitialisation + bufferSeconds`,
   encadré par les réglages ci-dessous.

La reprise automatique est ignorée en silence dans les 5 minutes qui suivent une
reprise précédente (protection anti-boucle), et se transforme en notification
(au lieu d'une planification) lorsque le plafond par session est atteint ou que
la réinitialisation est plus lointaine que `maxWaitHours`.

## Fournisseurs pris en charge

| Fournisseur | Détection | API d'usage pour `auto` |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `hit your ChatGPT usage limit`, `usage_limit_reached`, 429 | `GET /backend-api/wham/usage` → `primary_window.reset_at` |
| Anthropic (`anthropic`) | erreurs de limitation de débit, 429, en-têtes unified-reset | `GET /api/oauth/usage` → `five_hour.resets_at` (nécessite une connexion OAuth, pas une clé API) |
| Google Gemini (`google-gemini-cli`) | `RESOURCE_EXHAUSTED`, erreurs de quota | `POST v1internal:retrieveUserQuota` → le `buckets[].resetTime` le plus proche (nécessite le project id de la connexion CLI) |

Les jetons sont obtenus via `ctx.modelRegistry.getApiKeyForProvider()` (Pi gère
le rafraîchissement OAuth) ; l'extension ne lit jamais `auth.json` et ne
rafraîchit aucun jeton elle-même. Si une API d'usage est injoignable ou non
prise en charge, `auto` se dégrade en notification suggérant un
`/kg <durée>` manuel.

## Réglages

Tout ce qui suit a déjà une valeur par défaut fonctionnelle — un fichier de
configuration ne sert qu'à changer le comportement, par exemple désactiver la
reprise automatique ou envoyer un autre message.

La configuration globale se trouve dans `<pi agent dir>/keep-going.json`. Une
surcharge propre au projet dans `<cwd>/<pi config dir>/keep-going.json` n'est
appliquée **que si le projet est approuvé**. Les couches les plus tardives
gagnent ; les champs inconnus ou invalides sont ignorés.

```jsonc
{
  "defaultMessage": "keep going",
  "autoResume": {
    "enabled": true,        // interrupteur principal de la reprise automatique
    "message": "continue",  // message envoyé à la réouverture de la fenêtre
    "bufferSeconds": 90,    // attente supplémentaire après la réinitialisation
    "maxPerSession": 5,     // plafond de reprises automatiques par session
    "maxWaitHours": 24      // au-delà, notifier au lieu de planifier
  }
}
```

## Garde-fous

- **Garde de génération** — chaque session reçoit un `AbortController` et un
  identifiant de génération. Les appels à l'API d'usage pour `auto` s'exécutent
  avec un délai de 10 s composé avec le signal de session, et le résultat est
  jeté si la session a été remplacée pendant la requête.
- **Bail de déclencheur unique** — si deux processus Pi s'attachent à la même
  session, un verrou consultatif élit un seul déclencheur ; l'autre fonctionne
  en lecture seule, de sorte qu'une tâche est envoyée exactement une fois.

## Développement

```bash
npm install
npm run typecheck
npm test
pi -e ./src/index.ts   # chargement local
```

`@earendil-works/pi-coding-agent` est une **peer dependency** : elle est fournie
par le runtime Pi qui charge l'extension, elle ne doit donc pas être empaquetée.
Elle figure aussi en dev dependency ici pour que `tsc` et `vitest` la résolvent
localement.
