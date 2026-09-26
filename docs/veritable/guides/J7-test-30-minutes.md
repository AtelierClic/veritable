# Véritable — guide de test du J7 (30 minutes, carte du monde)

Préparation : `npm run dev`, puis http://localhost:9000 dans le navigateur. Les trois sauvegardes préparées sont dans `docs/veritable/guides/J7-saves/` ; elles se chargent par « Importer un fichier » du panneau de campagne (bouton « Véritable » en bas à gauche en jeu, ou le panneau du menu). Elles se régénèrent par `npx tsx tools/veritable/headless/prepareJ7Saves.ts --out docs/veritable/guides/J7-saves`.

## 1. Départ (3 min)

Panneau de campagne : « Le monde — 1er janvier 2026 », France, « Commencer ».

- Le bouton « Solo » d'OpenFront n'existe plus ; le panneau de campagne s'ouvre avec le menu.
- La carte se peint d'un coup (plus de terre nue pendant quinze secondes) ; la caméra se centre une fois sur Paris en zoom régional, puis ne bouge plus d'elle-même.
- Ni effectifs sous les noms, ni motifs sur les nations, ni barre de construction en bas ; le nom du Danemark est sur le Danemark, pas sur le Groenland.

## 2. Fiches au clic droit (5 min)

Clic droit sur l'Allemagne, puis sur le Brésil, puis sur la Russie. Le jeu ne s'arrête pas ; Échap ou un clic ailleurs ferme la fiche.

- **Allemagne** (alliée, OTAN et UE) : renseignement 3 partout, chiffres exacts, relation avec sa tendance sur six mois et la décomposition de l'affinité (blocs, idéologie, sanctions, défiance héritée, garanties, revendications).
- **Brésil** (lointain) : fourchettes de ±20 % ou ±40 %, datées (début du trimestre ou 1er janvier).
- **Russie** (adversaire) : fourchettes larges, « ? » pour l'armée, le nucléaire et les intentions ; sanctions dans les deux sens.

## 3. Modes de carte et mini-carte (3 min)

Touches V (politique), N (relations), O (blocs), X (guerres), H (population), I (renseignement), ou les boutons en bas à droite.

- Relations : orange hostile, gris neutre, bleu amical ; vous en blanc.
- Blocs : l'OTAN par défaut (le bloc le plus fort de la France) ; le menu en choisit un autre.
- Guerres : belligérants, fronts épaissis au dézoom, terres contestées hachurées.
- Population : la densité, du jaune pâle au violet ; les villes restent.
- La mini-carte montre le rectangle de la caméra ; un clic y conduit ; C ramène à Paris.

## 4. Cartes d'événements, pause, décision du gouvernement (5 min)

Passer à ×5.

- Un événement qui vous concerne apparaît en carte en haut à gauche, sous la barre du haut : le jeu s'arrête 3 secondes avec un compte à rebours sur le contrôle de vitesse, puis reprend à ×5. Espace pendant le compte à rebours garde la pause.
- Deux pauses automatiques sont séparées de 20 secondes réelles au moins.
- La carte donne la date, le pays, le titre, les choix (effets au survol), le délai restant et le penchant du gouvernement.
- Laisser une décision sans réponse : au bout de 30 jours de jeu, le gouvernement tranche ; le journal dit « Décidé par le gouvernement (parti) ».
- Réglages (roue sous la barre du haut) : durée 0, 3 ou 5 s, une case par catégorie.

## 5. Journal et marqueurs (3 min)

Écran « Journal » : filtres (ma nation, alliés, voisins, région, bloc, catégorie, période), recherche par nation. Un clic sur une entrée centre la caméra sur son lieu et ouvre la fiche du pays ; les marqueurs animés sur la carte se cliquent aussi.

## 6. Villes et densité (2 min)

Zoom sur l'Europe : points proportionnels à la population, étoiles des capitales, sans étiquettes qui se chevauchent ; au zoom du monde, seulement les capitales et les villes de plus de dix millions. Touche H : la densité.

## 7. Menu du clic gauche (4 min)

- **En paix** : clic gauche sur la Suisse → « Déclarer la guerre… » (casus belli, puis aperçu : partenaires qui sanctionneraient, nations tenues de la défendre, coût de relations), « Sanctionner… », « Proposer… », « Fiche ». Échap ferme ; les chiffres choisissent une entrée.
- **En guerre** : nouvelle campagne, Ukraine (en guerre depuis le 1er janvier 2026). Clic gauche sur le front, côté russe : « Attaquer ici », « Percer vers ce point », « Frappe aérienne… » ; sur la terre ukrainienne : « Construire ici… », « Déplacer des troupes », « Fortifier ».

## 8. Tir nucléaire (3 min)

Importer `j7-guerre-nucleaire.vsave` (France en guerre contre la Russie depuis le 2 janvier 2026). Écran « Fronts et divisions », section Nucléaire : tirer sur la capitale russe (deux clics, puis la confirmation).

- Moscou reste russe : aucune tuile ne change de propriétaire.
- Hachures jaunes et noires sur la terre contaminée, icône ☢ au point zéro, visible à tous les zooms.
- Journal : l'explosion, ses morts (de l'ordre d'un à deux millions pour une bombe H sur une agglomération de dix millions), les tuiles contaminées ; toutes les nations IA sanctionnent la France.

## 9. Exil (2 min)

Importer `j7-exil.vsave` (vous jouez l'Ukraine, annexée par la Russie par traité le 2 janvier 2026). Écran « Exil » : reconnaissance et soutien (parts du PIB mondial), leur somme contre le seuil de 60 %, la part qui reconnaît l'annexion, les mois sous le seuil, la résistance qui coûte de la stabilité à la Russie, les trois voies du retour. « Demander le retour » : un refus tant que la Russie reste forte.

## 10. Baroud d'honneur (2 min)

Importer `j7-baroud.vsave` (l'Ukraine vient d'être dissoute). Écran « Exil » : les nations de moins de dix millions d'habitants, sauf l'annexeur ; deux clics sur « Moldavie ». La barre du haut passe à la Moldavie, la caméra s'y rend (touche C), le journal garde toute l'histoire. Sauvegarder, recharger : la Moldavie, le journal intact.
