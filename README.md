# Game Stack Demo

Projet de test pour une stack Spring Boot + Angular + Discord.

## Structure

- `backend/` : Spring Boot API et intégration Discord via JDA.
- `frontend/` : application Angular simple pour tester les endpoints et envoyer une notification Discord.

## Démarrage

### Backend

1. Récupérer le token Discord :
   - Aller sur https://discord.com/developers/applications
   - Créer une nouvelle application
   - Aller dans la section "Bot" puis "Add Bot"
   - Copier le token dans "Token" / "Click to Reveal Token"
   - Ne jamais partager ce token en public.
2. Coller le token dans `backend/src/main/resources/application.yml` :
   ```yaml
   discord:
     token: "VOTRE_TOKEN_ICI"
     default-channel-id: "ID_DU_SALON"
   ```
   Ou définir `DISCORD_TOKEN` dans votre environnement.
3. Exécuter :
   - `cd backend`
   - `mvn spring-boot:run`
4. L’API sera disponible sur `http://localhost:8080`.

### Frontend

1. Installer les dépendances :
   - `cd frontend`
   - `npm install`
2. Lancer l’application Angular :
   - `npm start`
3. Ouvrir `http://localhost:4200`

## Test Discord

- Envoyer `!ping` ou `!status` sur un serveur où le bot est présent.
- Depuis le frontend, cliquer sur `Notifier Discord` pour appeler le backend.

## Mini-jeu de tir

- `POST /api/game/shoot?mode=archery` : tire une flèche.
- `POST /api/game/shoot?mode=darts` : lance une fléchette.
- `GET /api/game/status` : récupère le score total et le dernier tir.

Sur le frontend, utilise le sélecteur pour choisir entre `archery` et `darts`, puis clique sur "Tirer".

## Notes

- Le jeu métier n’est pas implémenté : la structure contient les points d’entrée du backend, un canal de notification Discord et un frontend de test.
- Vous pouvez ajouter une logique de lobby temps réel avec WebSocket et enrichir le bot Discord avec des commandes de quiz ou de mini-golf.
