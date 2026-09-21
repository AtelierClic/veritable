# J2 — guide de test en 15 minutes

Pour Lukas, au retour. Objectif : voir de ses yeux que l'économie, le budget et l'opinion réagissent, et dans le bon sens. Tous les chiffres ci-dessous sont des ordres de grandeur : la campagne a un aléa (bruit de croissance, chocs d'offre du reste du monde), deux parties ne donnent pas exactement les mêmes décimales.

## Mise en place (1 min)

```bash
npm run dev
```

Ouvrir http://localhost:9000 dans un vrai navigateur (pas le panneau intégré, qui bride ses timers). Bouton **Solo** (ou **Véritable** en bas à gauche) → **Nouvelle campagne** → scénario « Europe, dix nations » → nation **Allemagne** → **Commencer**.

Pourquoi l'Allemagne : elle importe presque tout son gaz et son pétrole, elle est dans l'UE (règle 3 % / 60 %) avec une dette juste au-dessus de 60 %, et son budget part en léger déficit. C'est la nation où tout se voit.

Dans la barre du haut : passer à **×5**. Un mois de jeu dure alors environ 12 secondes.

## 1. Lire l'état de départ (2 min)

**Économie.** L'Allemagne importe environ 1 150 TWh de pétrole, 750 de gaz, 210 de charbon ; elle exporte de l'électronique, de l'acier, des biens de consommation. Tous les prix sont à ×1,000, toutes les couvertures à 100 %. Laisser tourner deux mois : les prix bougent de quelques millièmes, c'est l'aléa du reste du monde.

**Budget.** Recettes ≈ 29 % du PIB, dépenses ≈ 33 %, solde ≈ −3,5 %, dette ≈ 64–65 % du PIB, taux ≈ 2,7 %. La mention « Réprimande de l'UE (3 % / 60 %) » apparaît dès le deuxième mois : dette au-dessus de 60 %.

**Opinion.** Stabilité ≈ 66 %, opinion qui glisse de 50 % vers 40–45 % en quelques mois (la réprimande coûte 3 points de cible à tous les groupes, et le déficit n'y est pour rien : c'est la dette).

## 2. Monter la TVA (3 min)

Budget → curseur **TVA** : le monter de 6 points (de ≈ 24 % à ≈ 30 %). Attendre un mois de jeu (12 s à ×5).

Ce qui doit bouger :

| Chiffre                        | Sens | Ordre de grandeur                             |
| ------------------------------ | ---- | --------------------------------------------- |
| Recettes                       | ↑    | +3 points de PIB (29 → 32–33 %)               |
| Solde                          | ↑    | passe de ≈ −3,5 % à ≈ 0                       |
| Opinion → Salariés             | ↓    | de ≈ 42 % vers ≈ 32 % en deux à trois mois    |
| Opinion → Jeunes, Agriculteurs | ↓    | plus légèrement                               |
| Opinion → Militaires           | =    | ne bouge pas                                  |
| Opinion (globale)              | ↓    | 3 à 5 points                                  |
| Stabilité                      | ↓    | 2 points environ (l'opinion pèse pour moitié) |

## 3. Couper le social, doper l'investissement (3 min)

Budget → **Social** : −3 points de PIB. **Infrastructures** : +2 points. **Recherche** : +1 point.

| Chiffre                       | Sens | Ordre de grandeur                                                                                                                                                                                           |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dépenses                      | =    | inchangées au total (−3 +2 +1)                                                                                                                                                                              |
| Opinion → Retraités           | ↓    | le plus touché (poids 0,25 sur le social)                                                                                                                                                                   |
| Opinion → Salariés, Minorités | ↓    |                                                                                                                                                                                                             |
| Opinion → Entrepreneurs       | ↑    | infrastructures et recherche                                                                                                                                                                                |
| Croissance (écran Économie)   | ↑    | +0,7 point par an environ (α = 0,02 par mois et par point de PIB investi) ; elle est affichée en rythme annuel du dernier mois, donc bruitée : regarder le PIB sur un an plutôt que la ligne « Croissance » |

Laisser tourner un an de jeu (≈ 2 min 30 à ×5). Le PIB allemand doit avoir gagné de l'ordre de 2 % (tendance 1 % + investissement), la dette/PIB doit baisser lentement (solde ≈ 0, PIB qui monte), et la réprimande de l'UE reste tant que la dette dépasse 60 %.

## 4. Casser le budget (3 min)

Remettre la TVA à son taux du premier jour (entre parenthèses à droite du curseur), puis pousser **Défense** à +5 points et **Social** à +5 points.

| Chiffre                         | Sens     | Ordre de grandeur                                                                            |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| Solde                           | ↓↓       | ≈ −13 % du PIB                                                                               |
| Dette / PIB                     | ↑        | +1 point par mois environ                                                                    |
| Taux d'intérêt                  | ↑        | lentement : +0,01 point par point de dette au-dessus de 60 %                                 |
| Opinion → Militaires, Retraités | ↑        |                                                                                              |
| Stabilité                       | ↑ puis ↓ | l'opinion monte d'abord ; la « santé de la dette » (15 % de la stabilité) se dégrade ensuite |

L'austérité forcée (dette ≥ 150 % et en hausse depuis 12 mois) et le défaut (≥ 200 %) demandent plusieurs années de ce régime : inutile d'attendre, ils sont couverts par les tests (`src/veritable/sim/economy/campaign.test.ts`).

## 5. Sauvegarder, recharger (1 min)

Panneau **Véritable** (bas gauche) → **Sauvegarder** → **Charger** cette sauvegarde. La date, les curseurs (valeurs courantes ≠ valeurs entre parenthèses), la dette et les satisfactions des groupes doivent revenir à l'identique. Une sauvegarde du J1 se charge aussi : son économie démarre alors des fiches (elle n'en avait pas).

## 6. Le choc gazier, sans jouer (2 min)

L'interface des sanctions est au J3a ; le choc se joue en headless :

```bash
npx tsx tools/veritable/headless/report.ts --out docs/veritable/reports/J2
```

Ouvrir `docs/veritable/reports/J2/shock-vs-control.svg` (déjà commité). Embargo sur le gaz russe vers les neuf autres nations en janvier 2028, même graine que le témoin :

| Courbe                       | Attendu                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Prix mondial du gaz          | décroche du témoin en janvier 2028, +6 % en huit mois, puis reste ≈ 6 % au-dessus (le gaz russe ne revient pas)   |
| Couverture en gaz, Allemagne | 100 % → ≈ 64 % en deux mois, retour à 100 % en huit à neuf mois : le prix a fait monter l'offre du reste du monde |
| PIB, Allemagne               | passe sous le témoin et n'y revient pas (≈ −0,5 %) : la croissance perdue est perdue                              |
| Stabilité, Allemagne         | ≈ −5 points pendant la pénurie, puis rejoint le témoin                                                            |

Les séries complètes sont dans `control.csv` et `shock.csv` (une ligne par mois de jeu : prix des douze biens, PIB, dette, stabilité, pénurie et couverture en gaz des dix nations).

## Ce qui est normal et ce qui ne l'est pas

Normal : une ligne « Croissance » qui saute d'un mois à l'autre ; des couvertures à 97–99 % sans embargo (le marché mondial n'est jamais exactement à l'équilibre) ; des nations IA dont la stabilité ne bouge presque pas (elles n'ont pas de groupes, c'est l'asymétrie voulue) ; la Russie qui ne souffre presque pas du choc gazier dans son PIB (la formule du PIB ne contient pas les exportations ; elle perd des rentes budgétaires).

À signaler : un prix qui touche ×0,25 ou ×4 ; une couverture qui reste sous 90 % plus d'un an sans embargo ; un curseur qui ne produit aucun effet après deux mois de jeu ; une sauvegarde rechargée dont les chiffres diffèrent.
