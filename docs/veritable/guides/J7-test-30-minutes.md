# J7 — guide de test en 30 minutes : la carte comme interface, le nucléaire, l'exil

Pour Lukas, avant le J7d. Objectif : jouer sur la carte du monde sans passer par les écrans pour tout, vérifier que le temps coule (cartes d'événements, pauses courtes, chiffres qui bougent), qu'un tir nucléaire ne fait plus disparaître de terre, et qu'une nation annexée vit en exil puis se dissout, avant un baroud d'honneur. Les chiffres sont des ordres de grandeur : une campagne neuve est tirée au hasard (graine = identifiant de la partie) ; les trois sauvegardes préparées donnent les mêmes chiffres à chaque chargement.

## Mise en place (2 min)

```bash
npm run dev
```

Ouvrir http://localhost:9000. Le panneau de campagne s'ouvre avec le menu (le bouton « Solo » d'OpenFront n'existe plus). Scénario **« Le monde — 1er janvier 2026 »**, **France**, **Commencer**.

Les trois sauvegardes préparées sont dans `docs/veritable/guides/J7-saves/`. En jeu, le bouton **« Véritable »** en bas à gauche ouvre le panneau ; **« Importer un fichier »** les charge. Elles se régénèrent par `npx tsx tools/veritable/headless/prepareJ7Saves.ts --out docs/veritable/guides/J7-saves`.

## 1. Départ (2 min)

- La carte se peint d'un coup, sans terre nue pendant quinze secondes. La caméra se centre une fois sur Paris à l'échelle d'une région, puis ne bouge plus d'elle-même.
- Pas d'effectifs sous les noms, pas de motifs sur les nations, pas de barre de construction en bas. Le nom du Danemark est sur le Danemark, pas sur le Groenland.
- Les écrans s'ouvrent à droite, sous la barre du haut et au-dessus de la mini-carte. La légende des fronts est en bas à gauche, au-dessus du bouton « Véritable ».

## 2. Fiches au clic droit (4 min)

Clic droit sur l'Allemagne, puis sur le Brésil, puis sur la Russie (la mini-carte en bas à droite conduit la caméra d'un clic). Le jeu ne s'arrête pas ; Échap ou un clic ailleurs ferme la fiche.

- **Allemagne** (OTAN et UE) : « renseignement complet » partout, chiffres exacts ; relation +61 avec sa tendance, qui monte vers +78 (blocs communs +60, proximité idéologique +18).
- **Brésil** (lointain) : fourchettes (population 196 à 217 millions, PIB 2,2 à 2,5 T$, stabilité 62 à 89 %), datées.
- **Russie** : relation −60 qui tend vers −84 (sanctions −40, défiance héritée −60) ; « en guerre contre l'Ukraine », sanctionnée par 43 nations ; embargos dans les deux sens sur onze biens ; fourchettes larges, « ? » pour les intentions.

## 3. Modes de carte et mini-carte (3 min)

Touches **V** (politique), **N** (relations), **O** (blocs), **X** (guerres), **H** (population), **I** (renseignement), ou les boutons en bas à droite. Un changement de mode prend moins d'une milliseconde.

- **Relations** : orange hostile, gris neutre, bleu amical ; vous en blanc.
- **Blocs** : l'OTAN par défaut (le bloc le plus fort de la France) ; le menu en choisit un autre (vert : membre, vert clair : candidat).
- **Guerres** : vos ennemis en rouge, vos alliés en guerre en bleu, les autres belligérants en orange ; terres contestées hachurées.
- **Population** : du jaune pâle au violet, source GHS-POP 2025 ; les villes restent.
- La mini-carte montre le rectangle de la caméra, un clic y conduit, **C** ramène à Paris.

## 4. Cartes d'événements, pause, décision du gouvernement (4 min)

Passer à **×5** (une année de jeu dure environ 2 min 30 s).

- Un événement de la France apparaît en carte en haut à gauche : le jeu s'arrête **3 secondes** (« Reprise dans 3 s » à côté des vitesses, « ⏸ 3 » sur le bouton), puis reprend à ×5. **Espace** pendant le compte à rebours garde la pause. Deux pauses automatiques sont séparées de 20 secondes réelles au moins ; sur cinq ans à ×5, elles prennent 6 % du temps.
- La carte donne la date, le pays, le titre, les choix (effets au survol), le délai restant (« encore 30 j ») et le penchant du gouvernement.
- Laisser une décision sans réponse : au bout de 30 jours de jeu, le gouvernement tranche. Le journal dit « Décidé par le gouvernement (Renaissance) ».
- Jamais plus de 300 jours de jeu sans une décision pour la France, jamais plus de deux par mois : dans une période calme, un gabarit de la France arrive au bout de dix mois.
- Les cartes de vote d'un bloc (par exemple « Vote — Union européenne, adhésion du Monténégro, proposé par Chypre ») portent des boutons de vote.
- Réglages (⚙ sous la barre du haut) : durée 0, 3 ou 5 s, une case par catégorie.

## 5. Journal et marqueurs (2 min)

Écran **Journal** : filtres (ma nation, alliés, voisins, région, bloc, catégorie, période), recherche par nation. Un clic sur une entrée (par exemple un mois de la guerre russo-ukrainienne) centre la caméra sur son lieu et ouvre la fiche du pays ; les marqueurs animés sur la carte se cliquent aussi.

## 6. Villes et densité (2 min)

À l'échelle de l'Europe : points proportionnels à la population, étoiles des capitales, sans étiquette qui en chevauche une autre. À l'échelle du monde : les capitales et les villes de plus de dix millions. **H** : la densité.

## 7. Menu du clic gauche (4 min)

- **En paix** : clic gauche sur l'Espagne : « Déclarer la guerre… » (casus belli, puis l'aperçu : partenaires qui sanctionneraient, nations tenues de la défendre, coût de relations), « Sanctionner… », « Proposer… », « Fiche du pays ». Échap ferme ; les chiffres choisissent une entrée.
- **En guerre** : recharger la page (F5), nouvelle campagne **Ukraine** (en guerre depuis le 1er janvier 2026). Clic gauche sur le front, côté russe : « Attaquer ici », « Percer vers ce point » (renfort de 3 divisions de la réserve), « Débarquer » (grisé : un front terrestre passe ici), « Frappe aérienne » (5 % de la capacité de l'ennemi × votre supériorité aérienne, une frappe tous les 30 jours), « Frappe nucléaire… » (aucune ogive). Sur la terre ukrainienne : « Construire ici… », « Déplacer des troupes », « Fortifier ».

## 8. Tir nucléaire (3 min)

Importer **`j7-guerre-nucleaire.vsave`** (France en guerre contre la Russie depuis le 2 janvier 2026). Écran **Fronts et divisions**, section Nucléaire : tirer sur la capitale russe (deux clics, puis la confirmation). Passer à ×1 : l'ogive vole deux ou trois jours.

- **Moscou reste russe** : aucune tuile ne change de propriétaire.
- Hachures jaunes et noires sur la terre contaminée (environ 80 tuiles), icône ☢ au point zéro, visible à tous les zooms. L'éclair et la fumée restent autour de Moscou (jusqu'ici, ils couvraient 750 km).
- Journal : l'explosion et ses morts, environ 1,2 million (une bombe H sur une agglomération de dix millions en tue de l'ordre d'un à deux millions). Presque toutes les nations sanctionnent la France : une cinquantaine de cartes, repliées en « + 48 ».
- Le tir part aussi dans les premiers jours d'une campagne ou juste après un chargement (il échouait en silence jusqu'ici).

## 9. Exil (2 min)

Importer **`j7-exil.vsave`** (vous jouez l'Ukraine, annexée par la Russie par traité le 2 janvier 2026). Écran **Exil** :

- reconnaissance 62 % du PIB mondial, soutien 0 %, total 62 % contre le seuil de 60 % ; l'annexion reconnue par 2 % (dissolution au-delà de 50 %) ; mois sous le seuil : 0 sur 12 ;
- la résistance coûte à la Russie 8 % de stabilité ;
- les trois voies du retour (libération, effondrement de l'occupant, négociation) ;
- **« Demander le retour »** : la Russie refuse (elle n'est ni assez faible ni assez isolée). Le journal le dit.
- L'Ukraine en exil ne tient plus d'élection.
- Sans terre, elle ne déclare aucune guerre : clic gauche sur la Russie, « Déclarer la guerre… » est grisé (« Votre nation n'a plus de terre »), et la Diplomatie ne propose aucun casus belli.

## 10. Baroud d'honneur (2 min)

Importer **`j7-baroud.vsave`** (la même Ukraine, son soutien coupé, dissoute le 2 février 2027). Écran **Exil** : « Votre État est dissous », puis la liste des nations de moins de dix millions d'habitants, sauf la Russie. Deux clics sur **Moldavie** : la barre du haut passe à la Moldavie, **C** y conduit la caméra, le journal garde toute l'histoire. Sauvegarder, recharger : la Moldavie, le journal intact.

## Ce que disent les mesures (lecture facultative)

- **Rythme** : `docs/veritable/reports/J7/rhythm/rhythm.json`, cinq ans de la France à ×5.
- **Performance** : `docs/veritable/reports/J7/perf/`. Dans le navigateur (`browser/`), ×5 entre 49,4 et 50,3 ticks/s en 2026, 2040, 2060 et 2075, villes et mode population actifs ; sauvegarde de 2,5 Mo à cinquante ans.
- **Tests forcés** : `docs/veritable/reports/J7/forced/`, 20 graines chacun. Bombe H sur Paris ; Autriche en exil ; dissolution sans soutien ; libération par la France ; baroud.
- **Campagnes mondiales** : `docs/veritable/reports/J7/world/`, 30 campagnes de 50 ans.
- **Tests joués** : `docs/veritable/reports/J7/playtest/`, captures des guides J4 à J7.

## Ce qui est normal et ce qui ne l'est pas

Normal :

- le premier mois après le départ ou un chargement est un peu plus lent (le code se compile) ;
- une carte critique (un exil, une frappe) reste jusqu'à ce qu'on la ferme ; les autres s'effacent après 8 secondes ;
- les terres d'une nation annexée sont hachurées (contestées) ;
- la France est sanctionnée par presque tout le monde après un tir ;
- une nation en exil sans soutien disparaît en un an et demi.

À signaler :

- une tuile qui change de propriétaire après un tir ;
- un tir qui échoue sans raison (« échec » dans la section Nucléaire alors qu'un silo existe) ;
- des noms de villes en double ;
- une pause automatique qui ne reprend pas seule ;
- ×5 qui saccade hors du premier mois ;
- une nation dissoute encore présente dans une guerre ou un bloc, ou une guerre déclarée à une nation en exil ;
- un prix mondial au-delà de deux fois sa base dans l'écran Économie ;
- un baroud qui ne se recharge pas sur la nouvelle nation.
