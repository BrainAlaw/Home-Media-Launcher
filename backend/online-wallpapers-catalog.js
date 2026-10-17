'use strict';

// Curated, license-verified (CC0 / public domain) wallpapers hosted on Wikimedia Commons.
// Every URL was checked for HTTP 200 + image content-type on 2026-10-17 (84 verified entries).
// Only these URLs are ever fetched; the renderer refers to entries by id.
const CATALOG = Object.freeze([
  {
    "id": "beach-with-rocky-shore",
    "name": "Beach with rocky shore",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Beach_with_rocky_shore_%28Unsplash%29.jpg/3840px-Beach_with_rocky_shore_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Beach_with_rocky_shore_%28Unsplash%29.jpg/500px-Beach_with_rocky_shore_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Timothy Kolczak tkolczak33",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Beach_with_rocky_shore_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "bright-skyline-over-water",
    "name": "Bright skyline over water",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Bright_skyline_over_water_%28Unsplash%29.jpg/3840px-Bright_skyline_over_water_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Bright_skyline_over_water_%28Unsplash%29.jpg/500px-Bright_skyline_over_water_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Osman Rana osmanrana",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Bright_skyline_over_water_%28Unsplash%29.jpg",
    "category": "Cities"
  },
  {
    "id": "four-lakes-and-a-waterfall",
    "name": "Four Lakes and a Waterfall",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Four_Lakes_and_a_Waterfall_%28Unsplash%29.jpg/3840px-Four_Lakes_and_a_Waterfall_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Four_Lakes_and_a_Waterfall_%28Unsplash%29.jpg/500px-Four_Lakes_and_a_Waterfall_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Evan Clark evanrclark",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Four_Lakes_and_a_Waterfall_%28Unsplash%29.jpg",
    "category": "Water"
  },
  {
    "id": "cherry-bloom",
    "name": "Cherry Bloom",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/Cherry_Bloom_%28Unsplash%29.jpg/3840px-Cherry_Bloom_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/91/Cherry_Bloom_%28Unsplash%29.jpg/500px-Cherry_Bloom_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Redd Angelo reddangelo16",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Cherry_Bloom_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "iceland",
    "name": "Iceland",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/31/Iceland_%28Unsplash_H3giJcTw_w%29.jpg/3840px-Iceland_%28Unsplash_H3giJcTw_w%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/31/Iceland_%28Unsplash_H3giJcTw_w%29.jpg/500px-Iceland_%28Unsplash_H3giJcTw_w%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Davide Cantelli cant89",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Iceland_%28Unsplash_H3giJcTw_w%29.jpg",
    "category": "Coast"
  },
  {
    "id": "deer-island-boston-united-states",
    "name": "Deer Island, Boston, United States",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/Deer_Island%2C_Boston%2C_United_States_%28Unsplash%29.jpg/3840px-Deer_Island%2C_Boston%2C_United_States_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/Deer_Island%2C_Boston%2C_United_States_%28Unsplash%29.jpg/500px-Deer_Island%2C_Boston%2C_United_States_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Oliver Pacas oliverpacas",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Deer_Island,_Boston,_United_States_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "desert",
    "name": "Desert",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Desert_%28Unsplash%29.jpg/3840px-Desert_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Desert_%28Unsplash%29.jpg/500px-Desert_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Piotr Chrobot chrumo",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "annie-spratt-2015-02-05",
    "name": "Annie Spratt 2015-02-05",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/Annie_Spratt_2015-02-05_%28Unsplash%29.jpg/3840px-Annie_Spratt_2015-02-05_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/Annie_Spratt_2015-02-05_%28Unsplash%29.jpg/500px-Annie_Spratt_2015-02-05_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Annie Spratt anniespratt",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Annie_Spratt_2015-02-05_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "frozen-crater-lake",
    "name": "Frozen Crater Lake",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Frozen_Crater_Lake_%28Unsplash%29.jpg/3840px-Frozen_Crater_Lake_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Frozen_Crater_Lake_%28Unsplash%29.jpg/500px-Frozen_Crater_Lake_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Stephen Daws boldlyboundless",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Frozen_Crater_Lake_%28Unsplash%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "observing-space",
    "name": "Observing space",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/54/Observing_space_%28Unsplash%29.jpg/3840px-Observing_space_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/54/Observing_space_%28Unsplash%29.jpg/500px-Observing_space_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jonatan Pie r3dmax",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Observing_space_%28Unsplash%29.jpg",
    "category": "Space"
  },
  {
    "id": "high-rise-buildings-of-manhattan-during-sunset",
    "name": "High-rise buildings of Manhattan during sunset",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/High-rise_buildings_of_Manhattan_during_sunset.jpg/3840px-High-rise_buildings_of_Manhattan_during_sunset.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/High-rise_buildings_of_Manhattan_during_sunset.jpg/500px-High-rise_buildings_of_Manhattan_during_sunset.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Ben o'bro",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:High-rise_buildings_of_Manhattan_during_sunset.jpg",
    "category": "Sky"
  },
  {
    "id": "city-skyline-urban-skyscrapers",
    "name": "City Skyline Urban Skyscrapers",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/City_Skyline_Urban_Skyscrapers_%28Unsplash%29.jpg/3840px-City_Skyline_Urban_Skyscrapers_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/City_Skyline_Urban_Skyscrapers_%28Unsplash%29.jpg/500px-City_Skyline_Urban_Skyscrapers_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Anthony DELANOIX anthonydelanoix",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:City_Skyline_Urban_Skyscrapers_%28Unsplash%29.jpg",
    "category": "Cities"
  },
  {
    "id": "hiking-havasu-falls",
    "name": "Hiking Havasu Falls",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/Hiking_Havasu_Falls_%28Unsplash%29.jpg/3840px-Hiking_Havasu_Falls_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/Hiking_Havasu_Falls_%28Unsplash%29.jpg/500px-Hiking_Havasu_Falls_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jeremy Bishop tidesinourveins",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Hiking_Havasu_Falls_%28Unsplash%29.jpg",
    "category": "Water"
  },
  {
    "id": "dawn-landscape-mountains-nature-3-24243399521",
    "name": "Dawn-landscape-mountains-nature-3 (24243399521)",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/Dawn-landscape-mountains-nature-3_%2824243399521%29.jpg/3840px-Dawn-landscape-mountains-nature-3_%2824243399521%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/Dawn-landscape-mountains-nature-3_%2824243399521%29.jpg/500px-Dawn-landscape-mountains-nature-3_%2824243399521%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "www.Pixel.la Free Stock Photos",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dawn-landscape-mountains-nature-3_%2824243399521%29.jpg",
    "category": "Sky"
  },
  {
    "id": "colorful-flowers-in-bloom",
    "name": "Colorful flowers in bloom",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Colorful_flowers_in_bloom_%28Unsplash%29.jpg/3840px-Colorful_flowers_in_bloom_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Colorful_flowers_in_bloom_%28Unsplash%29.jpg/500px-Colorful_flowers_in_bloom_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Rodion Kutsaev frostroomhead",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Colorful_flowers_in_bloom_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "icy-glacier-slope-in-kenai-fjords-national-park",
    "name": "Icy glacier slope in Kenai Fjords National Park",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Icy_glacier_slope_in_Kenai_Fjords_National_Park_%28Unsplash%29.jpg/3840px-Icy_glacier_slope_in_Kenai_Fjords_National_Park_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Icy_glacier_slope_in_Kenai_Fjords_National_Park_%28Unsplash%29.jpg/500px-Icy_glacier_slope_in_Kenai_Fjords_National_Park_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Phillip Sauerbeck totem_phillip",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Icy_glacier_slope_in_Kenai_Fjords_National_Park_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "bryce-canyon-national-park-snowy",
    "name": "Bryce Canyon National Park - snowy",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Bryce_Canyon_National_Park_-_snowy.jpeg/3840px-Bryce_Canyon_National_Park_-_snowy.jpeg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Bryce_Canyon_National_Park_-_snowy.jpeg/500px-Bryce_Canyon_National_Park_-_snowy.jpeg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Andy Wang",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Bryce_Canyon_National_Park_-_snowy.jpeg",
    "category": "Deserts"
  },
  {
    "id": "glowing-sunset-at-island-in-the-sky",
    "name": "Glowing sunset at Island in the Sky",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/83/Glowing_sunset_at_Island_in_the_Sky_%28Unsplash%29.jpg/3840px-Glowing_sunset_at_Island_in_the_Sky_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/83/Glowing_sunset_at_Island_in_the_Sky_%28Unsplash%29.jpg/500px-Glowing_sunset_at_Island_in_the_Sky_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Alexandre Chambon goodspleen",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Glowing_sunset_at_Island_in_the_Sky_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "desert-boulders",
    "name": "Desert Boulders",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/87/Desert_Boulders_%28Unsplash%29.jpg/3840px-Desert_Boulders_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/87/Desert_Boulders_%28Unsplash%29.jpg/500px-Desert_Boulders_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Rob Bye robertbye",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_Boulders_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "greener-pastures",
    "name": "Greener Pastures",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Greener_Pastures_%28Unsplash%29.jpg/3840px-Greener_Pastures_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Greener_Pastures_%28Unsplash%29.jpg/500px-Greener_Pastures_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "jesse orrico jessedo81",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Greener_Pastures_%28Unsplash%29.jpg",
    "category": "Mountains"
  },
  {
    "id": "bamboo-thicket",
    "name": "Bamboo thicket",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2c/Bamboo_thicket_%28Unsplash%29.jpg/3840px-Bamboo_thicket_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2c/Bamboo_thicket_%28Unsplash%29.jpg/500px-Bamboo_thicket_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Rohit Tandon rohittandon",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Bamboo_thicket_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "galaxy-unsplash-1",
    "name": "Galaxy unsplash 1",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/20/Galaxy_unsplash_1.jpg/3840px-Galaxy_unsplash_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/20/Galaxy_unsplash_1.jpg/500px-Galaxy_unsplash_1.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Dino Reichmuth",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Galaxy_unsplash_1.jpg",
    "category": "Space"
  },
  {
    "id": "frozen-lake-balaton",
    "name": "Frozen Lake Balaton",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Frozen_Lake_Balaton_%28Unsplash%29.jpg/3840px-Frozen_Lake_Balaton_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Frozen_Lake_Balaton_%28Unsplash%29.jpg/500px-Frozen_Lake_Balaton_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Paulo Ferreira pauloferreira",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Frozen_Lake_Balaton_%28Unsplash%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "sidewayslogs-byjnl",
    "name": "SidewaysLogs(byJNL)",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/SidewaysLogs%28byJNL%29.jpg/3840px-SidewaysLogs%28byJNL%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/SidewaysLogs%28byJNL%29.jpg/500px-SidewaysLogs%28byJNL%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jonas Nilsson Lee",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:SidewaysLogs%28byJNL%29.jpg",
    "category": "Space"
  },
  {
    "id": "car-parked-at-sandy-beach",
    "name": "Car parked at sandy beach",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Car_parked_at_sandy_beach_%28Unsplash%29.jpg/3840px-Car_parked_at_sandy_beach_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Car_parked_at_sandy_beach_%28Unsplash%29.jpg/500px-Car_parked_at_sandy_beach_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jeremy Bishop tidesinourveins",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Car_parked_at_sandy_beach_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "lights-of-rockefeller-center-during-sunset",
    "name": "Lights of Rockefeller Center during sunset",
    "url": "https://upload.wikimedia.org/wikipedia/commons/0/04/Lights_of_Rockefeller_Center_during_sunset.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
    "thumbUrl": "https://upload.wikimedia.org/wikipedia/commons/0/04/Lights_of_Rockefeller_Center_during_sunset.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail_unscaled",
    "author": "Pedro Lastra",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lights_of_Rockefeller_Center_during_sunset.jpg",
    "category": "Sky"
  },
  {
    "id": "city-skyline-from-above",
    "name": "City Skyline from Above",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/City_Skyline_from_Above_%28Unsplash%29.jpg/3840px-City_Skyline_from_Above_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/City_Skyline_from_Above_%28Unsplash%29.jpg/500px-City_Skyline_from_Above_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Devin McGloin devinmcgloin",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:City_Skyline_from_Above_%28Unsplash%29.jpg",
    "category": "Cities"
  },
  {
    "id": "hiking-by-the-waterfall",
    "name": "Hiking by the waterfall",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Hiking_by_the_waterfall_%28Unsplash%29.jpg/3840px-Hiking_by_the_waterfall_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Hiking_by_the_waterfall_%28Unsplash%29.jpg/500px-Hiking_by_the_waterfall_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Trent Yarnell tyarnell",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Hiking_by_the_waterfall_%28Unsplash%29.jpg",
    "category": "Water"
  },
  {
    "id": "dawn-nature-sunset-people-24218500272",
    "name": "Dawn-nature-sunset-people (24218500272)",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Dawn-nature-sunset-people_%2824218500272%29.jpg/3840px-Dawn-nature-sunset-people_%2824218500272%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Dawn-nature-sunset-people_%2824218500272%29.jpg/500px-Dawn-nature-sunset-people_%2824218500272%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "www.Pixel.la Free Stock Photos",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dawn-nature-sunset-people_%2824218500272%29.jpg",
    "category": "Sky"
  },
  {
    "id": "flower",
    "name": "Flower",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Flower_%28Unsplash%29.jpg/3840px-Flower_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Flower_%28Unsplash%29.jpg/500px-Flower_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Mahdi Fathi mahdif71",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Flower_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "lote-noruega",
    "name": "Lote, Noruega",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Lote%2C_Noruega.jpg/3840px-Lote%2C_Noruega.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Lote%2C_Noruega.jpg/500px-Lote%2C_Noruega.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Steinar La Engeland",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lote,_Noruega.jpg",
    "category": "Coast"
  },
  {
    "id": "cheddar-gorge-cheddar-united-kingdom",
    "name": "Cheddar Gorge, Cheddar, United Kingdom",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Cheddar_Gorge%2C_Cheddar%2C_United_Kingdom_%28Unsplash_tTgBq7wkMO8%29.jpg/3840px-Cheddar_Gorge%2C_Cheddar%2C_United_Kingdom_%28Unsplash_tTgBq7wkMO8%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Cheddar_Gorge%2C_Cheddar%2C_United_Kingdom_%28Unsplash_tTgBq7wkMO8%29.jpg/500px-Cheddar_Gorge%2C_Cheddar%2C_United_Kingdom_%28Unsplash_tTgBq7wkMO8%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Rich Lock richlock",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Cheddar_Gorge,_Cheddar,_United_Kingdom_%28Unsplash_tTgBq7wkMO8%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "gouqi-island-zhoushan-china",
    "name": "Gouqi Island, Zhoushan, China",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e1/Gouqi_Island%2C_Zhoushan%2C_China_%28Unsplash%29.jpg/3840px-Gouqi_Island%2C_Zhoushan%2C_China_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e1/Gouqi_Island%2C_Zhoushan%2C_China_%28Unsplash%29.jpg/500px-Gouqi_Island%2C_Zhoushan%2C_China_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Wu Jianxiong yeti",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Gouqi_Island,_Zhoushan,_China_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "hazy-mountaintops-at-dusk",
    "name": "Hazy mountaintops at dusk",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Hazy_mountaintops_at_dusk_%28Unsplash%29.jpg/3840px-Hazy_mountaintops_at_dusk_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Hazy_mountaintops_at_dusk_%28Unsplash%29.jpg/500px-Hazy_mountaintops_at_dusk_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Fré Sonneveld fresonneveld",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Hazy_mountaintops_at_dusk_%28Unsplash%29.jpg",
    "category": "Mountains"
  },
  {
    "id": "bethany-stephens-2016",
    "name": "Bethany Stephens 2016",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fe/Bethany_Stephens_2016_%28Unsplash%29.jpg/3840px-Bethany_Stephens_2016_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fe/Bethany_Stephens_2016_%28Unsplash%29.jpg/500px-Bethany_Stephens_2016_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Bethany Stephens bethanyiam",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Bethany_Stephens_2016_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "fir-trees-in-the-cold-snow",
    "name": "Fir trees in the cold snow",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Fir_trees_in_the_cold_snow_%28Unsplash%29.jpg/3840px-Fir_trees_in_the_cold_snow_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/f/fa/Fir_trees_in_the_cold_snow_%28Unsplash%29.jpg/500px-Fir_trees_in_the_cold_snow_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Dan Paul idantero",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Fir_trees_in_the_cold_snow_%28Unsplash%29.jpg",
    "category": "Winter"
  },
  {
    "id": "golden-night-milky-way",
    "name": "Golden Night Milky Way",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/Golden_Night_Milky_Way_%28Unsplash%29.jpg/3840px-Golden_Night_Milky_Way_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b2/Golden_Night_Milky_Way_%28Unsplash%29.jpg/500px-Golden_Night_Milky_Way_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Aperture Vintage aperturevintage",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Golden_Night_Milky_Way_%28Unsplash%29.jpg",
    "category": "Space"
  },
  {
    "id": "lake-louise",
    "name": "Lake Louise",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Lake_Louise_%28Unsplash_FJQAjFZwz0w%29.jpg/3840px-Lake_Louise_%28Unsplash_FJQAjFZwz0w%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Lake_Louise_%28Unsplash_FJQAjFZwz0w%29.jpg/500px-Lake_Louise_%28Unsplash_FJQAjFZwz0w%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Andreea Chidu achidu",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lake_Louise_%28Unsplash_FJQAjFZwz0w%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "starry-nebula-over-a-forest",
    "name": "Starry nebula over a forest",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Starry_nebula_over_a_forest_%28Unsplash%29.jpg/3840px-Starry_nebula_over_a_forest_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Starry_nebula_over_a_forest_%28Unsplash%29.jpg/500px-Starry_nebula_over_a_forest_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jamison McAndie jamomca",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Starry_nebula_over_a_forest_%28Unsplash%29.jpg",
    "category": "Space"
  },
  {
    "id": "dusk-on-beach-shore",
    "name": "Dusk on beach shore",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/74/Dusk_on_beach_shore_%28Unsplash%29.jpg/3840px-Dusk_on_beach_shore_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/74/Dusk_on_beach_shore_%28Unsplash%29.jpg/500px-Dusk_on_beach_shore_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Dustin Scarpitti dusty_blanco",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dusk_on_beach_shore_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "man-in-field-setting-sun",
    "name": "Man in field setting sun",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Man_in_field_setting_sun_%28Unsplash%29.jpg/3840px-Man_in_field_setting_sun_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Man_in_field_setting_sun_%28Unsplash%29.jpg/500px-Man_in_field_setting_sun_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Maxim Smith zoner",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Man_in_field_setting_sun_%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "city-covered-in-snow",
    "name": "City covered in snow",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/City_covered_in_snow_%28Unsplash%29.jpg/3840px-City_covered_in_snow_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/City_covered_in_snow_%28Unsplash%29.jpg/500px-City_covered_in_snow_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Ilya Orehov iliched",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:City_covered_in_snow_%28Unsplash%29.jpg",
    "category": "Cities"
  },
  {
    "id": "mcway-falls-1",
    "name": "McWay Falls 1",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/McWay_Falls_1_%28Unsplash%29.jpg/3840px-McWay_Falls_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/McWay_Falls_1_%28Unsplash%29.jpg/500px-McWay_Falls_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Denys Nevozhai dnevozhai",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:McWay_Falls_1_%28Unsplash%29.jpg",
    "category": "Water"
  },
  {
    "id": "dawn",
    "name": "Dawn",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/Dawn_%28Unsplash%29.jpg/3840px-Dawn_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/Dawn_%28Unsplash%29.jpg/500px-Dawn_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Andre Yanez andreyanez",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dawn_%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "flower-1",
    "name": "Flower 1",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/31/Flower_1_%28Unsplash%29.jpg/3840px-Flower_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/31/Flower_1_%28Unsplash%29.jpg/500px-Flower_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Hichem Meghachou hichem350z",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Flower_1_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "road-along-the-fjord",
    "name": "Road along the fjord",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Road_along_the_fjord_%28Unsplash%29.jpg/3840px-Road_along_the_fjord_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Road_along_the_fjord_%28Unsplash%29.jpg/500px-Road_along_the_fjord_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Danny Froese dannyfroese",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Road_along_the_fjord_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "climbing-in-golden-gate-canyon",
    "name": "Climbing in Golden Gate Canyon",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Climbing_in_Golden_Gate_Canyon_%28Unsplash%29.jpg/3840px-Climbing_in_Golden_Gate_Canyon_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/62/Climbing_in_Golden_Gate_Canyon_%28Unsplash%29.jpg/500px-Climbing_in_Golden_Gate_Canyon_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Lionello DelPiccolo liodp",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Climbing_in_Golden_Gate_Canyon_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "desert-formations",
    "name": "Desert Formations",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Desert_Formations_%28Unsplash%29.jpg/3840px-Desert_Formations_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Desert_Formations_%28Unsplash%29.jpg/500px-Desert_Formations_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Kyle Cesmat kylecesmat",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_Formations_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "hot-air-balloon-in-mountains",
    "name": "Hot air balloon in mountains",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Hot_air_balloon_in_mountains_%28Unsplash%29.jpg/3840px-Hot_air_balloon_in_mountains_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Hot_air_balloon_in_mountains_%28Unsplash%29.jpg/500px-Hot_air_balloon_in_mountains_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Thomas Kelley thkelley",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Hot_air_balloon_in_mountains_%28Unsplash%29.jpg",
    "category": "Mountains"
  },
  {
    "id": "fog-over-the-snow-topped-pines",
    "name": "Fog over the Snow Topped pines",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8a/Fog_over_the_Snow_Topped_pines_%28Unsplash%29.jpg/3840px-Fog_over_the_Snow_Topped_pines_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8a/Fog_over_the_Snow_Topped_pines_%28Unsplash%29.jpg/500px-Fog_over_the_Snow_Topped_pines_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Samuel Pagel spagel5",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Fog_over_the_Snow_Topped_pines_%28Unsplash%29.jpg",
    "category": "Winter"
  },
  {
    "id": "lake-louise-autumn",
    "name": "Lake Louise Autumn",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Lake_Louise_Autumn_%28Unsplash%29.jpg/3840px-Lake_Louise_Autumn_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Lake_Louise_Autumn_%28Unsplash%29.jpg/500px-Lake_Louise_Autumn_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Shane Hauser shanehauser",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lake_Louise_Autumn_%28Unsplash%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "tarantula-nebula-by-jwst",
    "name": "Tarantula Nebula by JWST",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/Tarantula_Nebula_by_JWST.jpg/3840px-Tarantula_Nebula_by_JWST.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/Tarantula_Nebula_by_JWST.jpg/500px-Tarantula_Nebula_by_JWST.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "NASA, ESA, CSA, STScI, Webb ERO Production Team",
    "license": "Public Domain",
    "source": "https://commons.wikimedia.org/wiki/File:Tarantula_Nebula_by_JWST.jpg",
    "category": "Space"
  },
  {
    "id": "jasper-boer-2015-06-05",
    "name": "Jasper Boer 2015-06-05",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cb/Jasper_Boer_2015-06-05_%28Unsplash_CvpWxeAEUOE%29.jpg/3840px-Jasper_Boer_2015-06-05_%28Unsplash_CvpWxeAEUOE%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cb/Jasper_Boer_2015-06-05_%28Unsplash_CvpWxeAEUOE%29.jpg/500px-Jasper_Boer_2015-06-05_%28Unsplash_CvpWxeAEUOE%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jasper Boer jasperboer",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Jasper_Boer_2015-06-05_%28Unsplash_CvpWxeAEUOE%29.jpg",
    "category": "Coast"
  },
  {
    "id": "dawn-emerick-2014",
    "name": "Dawn Emerick 2014",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Dawn_Emerick_2014_%28Unsplash%29.jpg/3840px-Dawn_Emerick_2014_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/Dawn_Emerick_2014_%28Unsplash%29.jpg/500px-Dawn_Emerick_2014_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Dawn Emerick freephotosbydawn",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dawn_Emerick_2014_%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "welcome-to-rey-arfj-r-ur",
    "name": "Welcome to Reyðarfjörður",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/Welcome_to_Rey%C3%B0arfj%C3%B6r%C3%B0ur_%28Unsplash%29.jpg/3840px-Welcome_to_Rey%C3%B0arfj%C3%B6r%C3%B0ur_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/Welcome_to_Rey%C3%B0arfj%C3%B6r%C3%B0ur_%28Unsplash%29.jpg/500px-Welcome_to_Rey%C3%B0arfj%C3%B6r%C3%B0ur_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Genevieve Perron-Migneron gen035",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Welcome_to_Rey%C3%B0arfj%C3%B6r%C3%B0ur_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "colca-canyon-chivay-peru",
    "name": "Colca Canyon, Chivay, Peru",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/Colca_Canyon%2C_Chivay%2C_Peru_%28Unsplash%29.jpg/3840px-Colca_Canyon%2C_Chivay%2C_Peru_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/ba/Colca_Canyon%2C_Chivay%2C_Peru_%28Unsplash%29.jpg/500px-Colca_Canyon%2C_Chivay%2C_Peru_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Nad Hemnani santtd",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Colca_Canyon,_Chivay,_Peru_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "desert-rock-spires",
    "name": "Desert Rock Spires",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Desert_Rock_Spires_%28Unsplash%29.jpg/3840px-Desert_Rock_Spires_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Desert_Rock_Spires_%28Unsplash%29.jpg/500px-Desert_Rock_Spires_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Tobias Keller tokeller",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_Rock_Spires_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "imperfect-days",
    "name": "Imperfect days",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Imperfect_days_%28Unsplash%29.jpg/3840px-Imperfect_days_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7b/Imperfect_days_%28Unsplash%29.jpg/500px-Imperfect_days_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Nathan Anderson nathananderson",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Imperfect_days_%28Unsplash%29.jpg",
    "category": "Mountains"
  },
  {
    "id": "forest-clearing-from-above-1",
    "name": "Forest clearing from above 1",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Forest_clearing_from_above_1_%28Unsplash%29.jpg/3840px-Forest_clearing_from_above_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0a/Forest_clearing_from_above_1_%28Unsplash%29.jpg/500px-Forest_clearing_from_above_1_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Anton Gudkov apgudkov",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Forest_clearing_from_above_1_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "frozen-winter-forest",
    "name": "Frozen winter forest",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Frozen_winter_forest_%28Unsplash%29.jpg/3840px-Frozen_winter_forest_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Frozen_winter_forest_%28Unsplash%29.jpg/500px-Frozen_winter_forest_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Les Anderson lesanderson",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Frozen_winter_forest_%28Unsplash%29.jpg",
    "category": "Winter"
  },
  {
    "id": "m-wrona-2017-05-30",
    "name": "M wrona 2017-05-30",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/M_wrona_2017-05-30_%28Unsplash%29.jpg/3840px-M_wrona_2017-05-30_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4c/M_wrona_2017-05-30_%28Unsplash%29.jpg/500px-M_wrona_2017-05-30_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "m wrona maciek_wrona",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:M_wrona_2017-05-30_%28Unsplash%29.jpg",
    "category": "Space"
  },
  {
    "id": "moody-beach-sunset",
    "name": "Moody beach sunset.",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Moody_beach_sunset._%28Unsplash%29.jpg/3840px-Moody_beach_sunset._%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Moody_beach_sunset._%28Unsplash%29.jpg/500px-Moody_beach_sunset._%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Hugo Kemmel hkemmel",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Moody_beach_sunset._%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "dubai-skyline-unsplash",
    "name": "Dubai skyline unsplash",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e4/Dubai_skyline_unsplash.jpg/3840px-Dubai_skyline_unsplash.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e4/Dubai_skyline_unsplash.jpg/500px-Dubai_skyline_unsplash.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Robert Bock",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dubai_skyline_unsplash.jpg",
    "category": "Cities"
  },
  {
    "id": "niagara-falls",
    "name": "Niagara Falls",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Niagara_Falls_%28Unsplash%29.jpg/3840px-Niagara_Falls_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Niagara_Falls_%28Unsplash%29.jpg/500px-Niagara_Falls_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Eva Blue evablue",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Niagara_Falls_%28Unsplash%29.jpg",
    "category": "Water"
  },
  {
    "id": "dawn-in-the-country",
    "name": "Dawn In The Country",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ee/Dawn_In_The_Country_%28Unsplash%29.jpg/3840px-Dawn_In_The_Country_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ee/Dawn_In_The_Country_%28Unsplash%29.jpg/500px-Dawn_In_The_Country_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Wojciech Święch becon",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dawn_In_The_Country_%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "flower-market-buckets",
    "name": "Flower market buckets",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/Flower_market_buckets_%28Unsplash%29.jpg/3840px-Flower_market_buckets_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/Flower_market_buckets_%28Unsplash%29.jpg/500px-Flower_market_buckets_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Alisa Anton alisaanton",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Flower_market_buckets_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "colorful-grand-canyon",
    "name": "Colorful Grand Canyon",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4b/Colorful_Grand_Canyon_%28Unsplash%29.jpg/3840px-Colorful_Grand_Canyon_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4b/Colorful_Grand_Canyon_%28Unsplash%29.jpg/500px-Colorful_Grand_Canyon_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Quinn Nietfeld quinton_nietfeld",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Colorful_Grand_Canyon_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "desert-stargazing",
    "name": "Desert Stargazing",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b4/Desert_Stargazing_%28Unsplash%29.jpg/3840px-Desert_Stargazing_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b4/Desert_Stargazing_%28Unsplash%29.jpg/500px-Desert_Stargazing_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Jamison McAndie jamomca",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_Stargazing_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "forest-fence",
    "name": "Forest fence",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/Forest_fence_%28Unsplash%29.jpg/3840px-Forest_fence_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/Forest_fence_%28Unsplash%29.jpg/500px-Forest_fence_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Sandis Helvigs sandishelvigs",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Forest_fence_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "man-stars-goblin-valley",
    "name": "Man Stars Goblin Valley",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/Man_Stars_Goblin_Valley_%28Unsplash%29.jpg/3840px-Man_Stars_Goblin_Valley_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c4/Man_Stars_Goblin_Valley_%28Unsplash%29.jpg/500px-Man_Stars_Goblin_Valley_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Greg Rakozy grakozy",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Man_Stars_Goblin_Valley_%28Unsplash%29.jpg",
    "category": "Space"
  },
  {
    "id": "lake-seen-from-a-wooden-platform",
    "name": "Lake seen from a wooden platform",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Lake_seen_from_a_wooden_platform_%28Unsplash%29.jpg/3840px-Lake_seen_from_a_wooden_platform_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4e/Lake_seen_from_a_wooden_platform_%28Unsplash%29.jpg/500px-Lake_seen_from_a_wooden_platform_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Tim Mossholder timmossholder",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lake_seen_from_a_wooden_platform_%28Unsplash%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "kris-atomic-2014-11-01",
    "name": "Kris Atomic 2014-11-01",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/76/Kris_Atomic_2014-11-01_%28Unsplash%29.jpg/3840px-Kris_Atomic_2014-11-01_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/76/Kris_Atomic_2014-11-01_%28Unsplash%29.jpg/500px-Kris_Atomic_2014-11-01_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Kris Atomic krisatomic",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Kris_Atomic_2014-11-01_%28Unsplash%29.jpg",
    "category": "Coast"
  },
  {
    "id": "frankfurt-skyline-at-night",
    "name": "Frankfurt Skyline at night",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/90/Frankfurt_Skyline_at_night_%28Unsplash%29.jpg/3840px-Frankfurt_Skyline_at_night_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/90/Frankfurt_Skyline_at_night_%28Unsplash%29.jpg/500px-Frankfurt_Skyline_at_night_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Mathias Konrath konni",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Frankfurt_Skyline_at_night_%28Unsplash%29.jpg",
    "category": "Cities"
  },
  {
    "id": "patrick-hendry-2016-09-01",
    "name": "Patrick Hendry 2016-09-01",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Patrick_Hendry_2016-09-01_%28Unsplash_NdLplBqacAc%29.jpg/3840px-Patrick_Hendry_2016-09-01_%28Unsplash_NdLplBqacAc%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d9/Patrick_Hendry_2016-09-01_%28Unsplash_NdLplBqacAc%29.jpg/500px-Patrick_Hendry_2016-09-01_%28Unsplash_NdLplBqacAc%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Patrick Hendry worldsbetweenlines",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Patrick_Hendry_2016-09-01_%28Unsplash_NdLplBqacAc%29.jpg",
    "category": "Water"
  },
  {
    "id": "gr-dina-botanic-bucure-ti-romania",
    "name": "Grădina Botanică, București, Romania",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/15/Gr%C4%83dina_Botanic%C4%83%2C_Bucure%C8%99ti%2C_Romania_%28Unsplash%29.jpg/3840px-Gr%C4%83dina_Botanic%C4%83%2C_Bucure%C8%99ti%2C_Romania_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/15/Gr%C4%83dina_Botanic%C4%83%2C_Bucure%C8%99ti%2C_Romania_%28Unsplash%29.jpg/500px-Gr%C4%83dina_Botanic%C4%83%2C_Bucure%C8%99ti%2C_Romania_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Alex Blăjan alexb",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Gr%C4%83dina_Botanic%C4%83,_Bucure%C8%99ti,_Romania_%28Unsplash%29.jpg",
    "category": "Nature"
  },
  {
    "id": "dusty-canyon-road",
    "name": "Dusty canyon road",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Dusty_canyon_road_%28Unsplash%29.jpg/3840px-Dusty_canyon_road_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/Dusty_canyon_road_%28Unsplash%29.jpg/500px-Dusty_canyon_road_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Caylee Betts cayleebetts",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Dusty_canyon_road_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "island-of-hawai-i-united-states",
    "name": "Island of Hawai'i, United States",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/Island_of_Hawai%27i%2C_United_States_%28Unsplash_nIA5GpqvYdM%29.jpg/3840px-Island_of_Hawai%27i%2C_United_States_%28Unsplash_nIA5GpqvYdM%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/44/Island_of_Hawai%27i%2C_United_States_%28Unsplash_nIA5GpqvYdM%29.jpg/500px-Island_of_Hawai%27i%2C_United_States_%28Unsplash_nIA5GpqvYdM%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Sarah Humer sarahhumer",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Island_of_Hawai'i,_United_States_%28Unsplash_nIA5GpqvYdM%29.jpg",
    "category": "Coast"
  },
  {
    "id": "desert-sunrise",
    "name": "Desert Sunrise",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Desert_Sunrise_%28Unsplash%29.jpg/3840px-Desert_Sunrise_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b0/Desert_Sunrise_%28Unsplash%29.jpg/500px-Desert_Sunrise_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Red Morley Hewitt redvers",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Desert_Sunrise_%28Unsplash%29.jpg",
    "category": "Deserts"
  },
  {
    "id": "misty-morning-mountain",
    "name": "Misty morning mountain",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Misty_morning_mountain_%28Unsplash%29.jpg/3840px-Misty_morning_mountain_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Misty_morning_mountain_%28Unsplash%29.jpg/500px-Misty_morning_mountain_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "jesse orrico jessedo81",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Misty_morning_mountain_%28Unsplash%29.jpg",
    "category": "Mountains"
  },
  {
    "id": "forest-skyline-and-clouds",
    "name": "Forest skyline and clouds",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e0/Forest_skyline_and_clouds_%28Unsplash%29.jpg/3840px-Forest_skyline_and_clouds_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e0/Forest_skyline_and_clouds_%28Unsplash%29.jpg/500px-Forest_skyline_and_clouds_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Fineas Anton fineas_anton",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Forest_skyline_and_clouds_%28Unsplash%29.jpg",
    "category": "Forests"
  },
  {
    "id": "ian-schneider-2015",
    "name": "Ian Schneider 2015",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Ian_Schneider_2015_%28Unsplash%29.jpg/3840px-Ian_Schneider_2015_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/Ian_Schneider_2015_%28Unsplash%29.jpg/500px-Ian_Schneider_2015_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Ian Schneider goian",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Ian_Schneider_2015_%28Unsplash%29.jpg",
    "category": "Winter"
  },
  {
    "id": "lake-with-boat-and-grass",
    "name": "Lake with boat and grass",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2d/Lake_with_boat_and_grass_%28Unsplash%29.jpg/3840px-Lake_with_boat_and_grass_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2d/Lake_with_boat_and_grass_%28Unsplash%29.jpg/500px-Lake_with_boat_and_grass_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Brandon Morgan littleppl85",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Lake_with_boat_and_grass_%28Unsplash%29.jpg",
    "category": "Lakes"
  },
  {
    "id": "peaceful-lake-sunset",
    "name": "Peaceful lake sunset.",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Peaceful_lake_sunset._%28Unsplash%29.jpg/3840px-Peaceful_lake_sunset._%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Peaceful_lake_sunset._%28Unsplash%29.jpg/500px-Peaceful_lake_sunset._%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "Todd DeSantis todddesantis",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Peaceful_lake_sunset._%28Unsplash%29.jpg",
    "category": "Sky"
  },
  {
    "id": "golden-city-skyline",
    "name": "Golden city skyline",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Golden_city_skyline_%28Unsplash%29.jpg/3840px-Golden_city_skyline_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "thumbUrl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/Golden_city_skyline_%28Unsplash%29.jpg/500px-Golden_city_skyline_%28Unsplash%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
    "author": "chuttersnap chuttersnap",
    "license": "CC0",
    "source": "https://commons.wikimedia.org/wiki/File:Golden_city_skyline_%28Unsplash%29.jpg",
    "category": "Cities"
  }
].map((entry) => Object.freeze(entry)));

module.exports = { CATALOG };
