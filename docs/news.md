# News and Changelog

---

## November 07, 2025

### Version 1.2.2 New Feature: Free-tier is being added

* Users now can access free-of-charge the stable price de-margined odds for the following competitions:

| Competition ID       | Competition            | Country |
| :------- | :--------------------- |
| 7   | Primera División    | Spain |
| 8 | Premier League     | England
| 9   | Bundesliga   | Germany |
| 10  UEFA Champions League    | European Cup |
| 13   | Serie A        | Italy |
| 16   | Ligue 1        | France |
| 18   | UEFA Europa League        | European Cup |
| 26   | Serie A       | Brazil |
| 87   | Liga Profesional Argentina       | Argentina |

---

## October 16, 2025

### New Feature: P2P Offer Cancellation

* Users can now cancel their open P2P trade offers via a new `/trading/offer/cancel` endpoint.

### Improvements

* Integrated a "soft check" for token balances. The server will now verify a user has sufficient funds before persisting a new offer or accepting an existing offer.

---

## October 14, 2025

### New content

* US College Basketball has been added to the `scores` channel.
* US College Basketball is enabled for P2P Trading and examples added in this repository.

### Documentation

* US College Basketball statistics as used for P2P Trading are described in detail in the main documentation.
