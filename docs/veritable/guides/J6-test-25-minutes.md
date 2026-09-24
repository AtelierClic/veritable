# J6 — guide de test en 25 minutes : le monde de 2026

Pour Lukas, au retour. Objectif : lancer une campagne sur la carte monde, vérifier qu'on s'y retrouve parmi 208 nations, que le monde de 2026 est bien là (entités de facto, guerres, sanctions, blocs), que ×5 tient, et qu'une année passe sans accroc. Les chiffres sont des ordres de grandeur ; la campagne est tirée au hasard (graine = identifiant de la partie).

## Mise en place (2 min)

```bash
npm run dev
```

Ouvrir http://localhost:9000. **Solo** → dans le panneau Véritable, scénario **« Le monde — 1er janvier 2026 »**. La petite carte du scénario apparaît sous le choix.

- **Cliquer sur l'Inde** sur la petite carte : le nom s'affiche sous la carte, avec sa sous-région (« Asie du Sud »).
- Taper **« fra »** dans la recherche : la liste se réduit à la France (la casse et les accents sont ignorés). Choisir **France**, puis **Commencer**.

Chargement : 3 à 5 secondes (carte `giantworldmap`, 4 108 × 1 948 tuiles, 208 nations dont 13 entités de facto et 28 micro-États sans tuile).

## 1. Le monde du premier jour (5 min)

**La carte.** Les frontières de facto : Crimée et est de l'Ukraine russes, Taïwan, Kosovo, Chypre du Nord, Abkhazie et Ossétie du Sud, Transnistrie, Somaliland, le Sahara occidental coupé au mur des sables, le Yémen d'Ansar Allah, la Libye orientale, les Forces de soutien rapide au Soudan, le Nord-Est syrien, l'AFC/M23 à l'est de la RD Congo. Les tuiles contestées sont hachurées. Trois fronts sont actifs : Russie–Ukraine, FSR–Soudan, AFC/M23–RD Congo (légende des fronts en bas à gauche).

**Diplomatie et sanctions.** 207 nations. Essayer :

- filtre **bloc = OTAN**, tri **par relations** : « 31 sur 207 » ; en tête les alliés qui sont aussi dans l'UE (Tchéquie 64, Hongrie 63, Lituanie 62, Allemagne 61…), puis le Canada vers 52 et les autres alliés hors UE plus bas ;
- recherche **« russ »**, cliquer **Russie** : relations −60, sanctions de l'UE en vigueur (« de politique » : elles ne tombent qu'avec un changement de régime), et en dessous **les embargos de la Russie dans les deux sens**, bien par bien ;
- filtre **région = Afrique**, tri **par stabilité** : les moins stables en tête, dont les États en conflit interne du scénario (Soudan, Somalie, Mali, Burkina Faso…).

**Dirigeants** et **Opinion** : mêmes filtres. Filtre **Asie**, tri **par PIB** : la Chine en tête, puis le Japon et l'Inde, avec leurs dirigeants au 1er janvier 2026.

**Blocs.** L'UE est présidée par **Chypre** jusqu'au 30 juin 2026 (puis l'Irlande), l'OTAN dirigée par les **États-Unis** ; 27 membres de l'UE qui votent et paient, 32 de l'OTAN.

## 2. Une année à ×5 (8 min)

Lancer **×5**. Une année de jeu dure environ 2 min 30 s. Les fenêtres d'événements mettent le jeu en pause : répondre (ou laisser le gouvernement trancher au bout d'un mois).

| Chiffre            | Où                   | Ordre de grandeur                                                                                                                         |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Vitesse            | barre du haut, date  | un jour de jeu ≈ 0,4 s ; mesuré à 49,3-50 ticks/s (critère 49) ; le premier 1er du mois d'une session marque un léger à-coup (code froid) |
| Présidence de l'UE | Blocs                | Irlande au 1er juillet 2026, Lituanie au 1er janvier 2027                                                                                 |
| Guerres            | Fronts et divisions  | les trois du scénario ; une nouvelle guerre dans le monde tous les quatre ans environ                                                     |
| Prix               | Économie             | pétrole entre 1 et 1,4 × sa base la première année (sanctions de 2026)                                                                    |
| Journal            | Objectifs et journal | élections du monde, coups (surtout en régimes autoritaires, juntes et États faillis), décisions des blocs                                 |

## 3. Sauvegarder et reprendre (3 min)

Panneau **Véritable** → **Sauvegarder**. Taille : 1,4 Mo au départ, 1,5 Mo après un an, 2,0 Mo après cinquante. Recharger la page, **Charger** : même date, mêmes guerres, mêmes sanctions.

## 4. Ce que disent les 30 campagnes (lecture, 5 min)

`docs/veritable/reports/J6/world/summary.json` et `campaigns.csv` : 30 campagnes de 50 ans sur le cœur. RÉSULTATS À COMPLÉTER.

## Ce qui est normal et ce qui ne l'est pas

Normal : le premier mois de jeu est un peu plus lent (le code se compile) ; des nations sans tuile (micro-États) listées partout mais absentes de la carte ; des sanctions de 2026 qui ne tombent jamais tant que le régime visé n'a pas changé ; des guerres surtout en Afrique, au Moyen-Orient et autour de la Russie ; pas de guerre entre membres de l'OTAN ou de l'UE.

À signaler : un pays qui disparaît de la liste des nations ; une guerre entre deux voisins amis (relations au-dessus de −10) ; un tir nucléaire sans que le tireur ait perdu de terre ou vu sa capitale menacée ; un prix au-delà de deux fois sa base ; ×5 qui saccade ; une sauvegarde rechargée qui diffère.
